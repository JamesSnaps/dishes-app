// The device's copy of the household: a GRDB (SQLite) database with the same
// shape as the web's Dexie store (apps/web/lib/sync-store.ts) behind the
// SyncStore contract in packages/client/src/types.ts:
//
//   records  every synced row, as the server's JSON, keyed by (collection, id)
//   outbox   mutations not yet accepted by the server, in the order they were made
//   meta     the sync cursor and other small values
//
// Rows are stored whole rather than in typed columns, so a column the server
// adds later survives the round trip and the app only has to learn to read it.
//
//   let store = try LocalStore(path: url.path)        // on disk (DatabasePool, WAL)
//   let store = try LocalStore.inMemory()             // tests and previews
//   let items = try await store.read { try $0.records(.shoppingItems) }
//   for try await items in store.observe({ try $0.records(.shoppingItems) }) { … }   // SwiftUI

import Foundation
import GRDB

public final class LocalStore: Sendable {
    let writer: any DatabaseWriter

    /// Opens (or creates) the database at `path`, running any new migrations.
    public convenience init(path: String) throws {
        try self.init(writer: DatabasePool(path: path))
    }

    /// A private database in memory.
    public static func inMemory() throws -> LocalStore {
        try LocalStore(writer: DatabaseQueue())
    }

    init(writer: any DatabaseWriter) throws {
        self.writer = writer
        try Self.migrator.migrate(writer)
    }

    // MARK: Access

    public func read<T: Sendable>(_ body: @Sendable @escaping (StoreReader) throws -> T) async throws -> T {
        try await writer.read { db in try body(StoreReader(db: db)) }
    }

    /// One write transaction: all of it is saved, or none of it.
    public func write<T: Sendable>(_ body: @Sendable @escaping (StoreWriter) throws -> T) async throws -> T {
        try await writer.write { db in try body(StoreWriter(db: db)) }
    }

    /// Values that update themselves whenever a write changes what they read —
    /// how sync's writes reach SwiftUI without anyone asking.
    public func observe<T: Sendable>(_ fetch: @Sendable @escaping (StoreReader) throws -> T) -> AsyncValueObservation<T> {
        ValueObservation.tracking { db in try fetch(StoreReader(db: db)) }.values(in: writer)
    }

    // MARK: Schema

    /// Append-only: add a new migration rather than editing one that has shipped.
    static var migrator: DatabaseMigrator {
        var m = DatabaseMigrator()
        m.registerMigration("v1") { db in
            try db.execute(sql: """
                CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

                CREATE TABLE records (
                  collection TEXT NOT NULL, id TEXT NOT NULL, json BLOB NOT NULL,
                  PRIMARY KEY (collection, id)
                );

                CREATE TABLE outbox (
                  seq INTEGER PRIMARY KEY AUTOINCREMENT,
                  op_id TEXT NOT NULL UNIQUE,
                  type TEXT NOT NULL,
                  payload BLOB NOT NULL,
                  queued_at INTEGER NOT NULL,
                  temporary BLOB
                );
                """)
        }
        return m
    }
}

/// Reads, inside one consistent snapshot.
public struct StoreReader {
    let db: Database

    public func records(_ collection: SyncCollection) throws -> [JSONValue] {
        try Data.fetchAll(db, sql: "SELECT json FROM records WHERE collection = ?", arguments: [collection.rawValue])
            .compactMap { try? JSONDecoder().decode(JSONValue.self, from: $0) }
    }

    public func record(_ collection: SyncCollection, id: String) throws -> JSONValue? {
        try Data.fetchOne(db, sql: "SELECT json FROM records WHERE collection = ? AND id = ?",
                          arguments: [collection.rawValue, id])
            .flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) }
    }

    public func cursor() throws -> String? {
        try meta("cursor")
    }

    public func meta(_ key: String) throws -> String? {
        try String.fetchOne(db, sql: "SELECT value FROM meta WHERE key = ?", arguments: [key])
    }

    /// Queued mutations, oldest first.
    public func pendingMutations() throws -> [QueuedMutation] {
        try Row.fetchAll(db, sql: "SELECT op_id, type, payload, queued_at, temporary FROM outbox ORDER BY seq").map { row in
            let payload: Data = row["payload"]
            let temporary: Data? = row["temporary"]
            return QueuedMutation(
                opId: row["op_id"], type: row["type"],
                payload: (try? JSONDecoder().decode(JSONValue.self, from: payload)) ?? .object([:]),
                queuedAt: row["queued_at"],
                temporary: temporary.flatMap { try? JSONDecoder().decode([RecordRef].self, from: $0) } ?? [])
        }
    }

    public func pendingCount() throws -> Int {
        try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM outbox") ?? 0
    }
}

/// Writes, inside one transaction.
public struct StoreWriter {
    let db: Database

    public var reader: StoreReader { StoreReader(db: db) }

    public func put(_ collection: SyncCollection, _ record: JSONValue) throws {
        guard let id = record.id else { return }
        try db.execute(sql: "INSERT OR REPLACE INTO records (collection, id, json) VALUES (?, ?, ?)",
                       arguments: [collection.rawValue, id, try JSONEncoder().encode(record)])
    }

    public func remove(_ collection: SyncCollection, id: String) throws {
        try db.execute(sql: "DELETE FROM records WHERE collection = ? AND id = ?", arguments: [collection.rawValue, id])
    }

    public func setMeta(_ key: String, _ value: String?) throws {
        if let value {
            try db.execute(sql: "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", arguments: [key, value])
        } else {
            try db.execute(sql: "DELETE FROM meta WHERE key = ?", arguments: [key])
        }
    }

    /// Upsert changed records and remove deleted ids, then save the cursor —
    /// in the caller's transaction, so a half-applied page can't outlive a crash.
    public func applyPull(_ page: PullResponse) throws {
        for collection in SyncCollection.allCases {
            for record in page.changes(in: collection) { try put(collection, record) }
            for id in page.deleted(in: collection) { try remove(collection, id: id) }
        }
        try setMeta("cursor", page.cursor)
    }

    public func enqueue(_ mutation: QueuedMutation) throws {
        try db.execute(
            sql: "INSERT INTO outbox (op_id, type, payload, queued_at, temporary) VALUES (?, ?, ?, ?, ?)",
            arguments: [mutation.opId, mutation.type, try JSONEncoder().encode(mutation.payload), mutation.queuedAt,
                        mutation.temporary.isEmpty ? nil : try JSONEncoder().encode(mutation.temporary)])
    }

    public func dequeue(_ opIds: [String]) throws {
        for id in opIds { try db.execute(sql: "DELETE FROM outbox WHERE op_id = ?", arguments: [id]) }
    }

    /// Forgets every synced row and the cursor, keeping the outbox: used when
    /// the server reports an unusable cursor, and the person's unsent changes
    /// are still theirs to send.
    public func clearRecords() throws {
        try db.execute(sql: "DELETE FROM records")
        try setMeta("cursor", nil)
    }

    /// Everything, outbox included (signing out of one server to use another).
    public func wipe() throws {
        try db.execute(sql: "DELETE FROM records; DELETE FROM outbox; DELETE FROM meta")
    }
}
