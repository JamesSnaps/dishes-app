// The database in the App Group container, where the widgets (D4) and the
// share extension (D3) can reach it — TODO_MOBILE.md, Phase D0.
//
// A SQLite file in a shared container needs more care than one in the app's
// own folder (GRDB's "Sharing a Database" guide, which this follows):
//
//   - persistent WAL, so a read-only process can always open it (the -wal and
//     -shm files are never deleted)
//   - a busy timeout, so a write waits for another process's instead of failing
//   - opening under NSFileCoordinator, so two processes don't both create it
//   - suspension: iOS kills an app holding a lock on a file in a shared
//     container when it's suspended (0xDEAD10CC). The app posts
//     `LocalStore.suspend()` before it can be suspended and `resume()` before
//     touching the database again; a suspended store still reads, but a write
//     throws (SQLITE_ABORT) instead of taking the lock
//
//   let url = AppGroup.databaseURL ?? fallback
//   try LocalStore.moveDatabase(from: old, to: url)   // once, before opening
//   let store = try LocalStore(sharedPath: url.path)

import Foundation
import GRDB
import SQLite3

/// The App Group the app, its widgets and its share extension have in common.
public enum AppGroup {
    public static let identifier = "group.uk.collco.dishes"

    /// nil in a build signed without the group (the app keeps its own folder).
    public static var containerURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: identifier)
    }

    /// <group>/Library/Application Support/Dishes/dishes.sqlite, left out of
    /// backups as the app's own copy was: the server is the copy that matters.
    public static var databaseURL: URL? {
        guard let container = containerURL else { return nil }
        return databaseURL(in: container)
    }

    static func databaseURL(in container: URL) -> URL {
        var folder = container.appendingPathComponent("Library/Application Support/Dishes", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? folder.setResourceValues(values)
        return folder.appendingPathComponent("dishes.sqlite")
    }
}

extension LocalStore {
    /// Opens (or creates) a database another process may also open: the App
    /// Group copy. Writes wait up to `busyTimeout` for another process's.
    public convenience init(sharedPath path: String, busyTimeout: TimeInterval = 5) throws {
        var configuration = Configuration()
        configuration.busyMode = .timeout(busyTimeout)
        configuration.observesSuspensionNotifications = true
        configuration.prepareDatabase { db in
            guard !db.configuration.readonly else { return }
            var flag: CInt = 1
            let code = withUnsafeMutablePointer(to: &flag) { flag in
                sqlite3_file_control(db.sqliteConnection, nil, SQLITE_FCNTL_PERSIST_WAL, flag)
            }
            guard code == SQLITE_OK else { throw DatabaseError(resultCode: ResultCode(rawValue: code)) }
        }
        var opened: DatabasePool?
        var openError: Error?
        var coordinationError: NSError?
        NSFileCoordinator(filePresenter: nil).coordinate(
            writingItemAt: URL(fileURLWithPath: path), options: .forMerging, error: &coordinationError
        ) { url in
            do { opened = try DatabasePool(path: url.path, configuration: configuration) } catch { openError = error }
        }
        if let error = openError ?? coordinationError { throw error }
        try self.init(writer: opened!)
    }

    /// Stop taking database locks: the app may be suspended (see the top of this file).
    public static func suspend() {
        NotificationCenter.default.post(name: Database.suspendNotification, object: nil)
    }

    /// Writes work again.
    public static func resume() {
        NotificationCenter.default.post(name: Database.resumeNotification, object: nil)
    }

    /// Another process (a widget's tick) may have written while this one wasn't
    /// looking, and GRDB's observations only see this process's own writes:
    /// every observation reads again.
    public func noticeOtherProcesses() async throws {
        try await writer.write { db in try db.notifyChanges(in: DatabaseRegion.fullDatabase) }
    }

    /// The database and its -wal / -shm files moved from `old` to `new`, once:
    /// nothing happens when `new` already exists or there's nothing at `old`.
    /// Call it before either is opened, so no connection holds the files. The
    /// -wal file holds writes not yet copied into the main file, so the three
    /// go together or the move is undone.
    public static func moveDatabase(from old: URL, to new: URL) throws {
        let files = FileManager.default
        guard files.fileExists(atPath: old.path), !files.fileExists(atPath: new.path) else { return }
        try files.createDirectory(at: new.deletingLastPathComponent(), withIntermediateDirectories: true)
        var moved: [(URL, URL)] = []
        do {
            for suffix in ["", "-wal", "-shm"] {
                let from = URL(fileURLWithPath: old.path + suffix), to = URL(fileURLWithPath: new.path + suffix)
                guard files.fileExists(atPath: from.path) else { continue }
                try files.moveItem(at: from, to: to)
                moved.append((from, to))
            }
        } catch {
            for (from, to) in moved.reversed() { try? files.moveItem(at: to, to: from) }
            throw error
        }
    }
}
