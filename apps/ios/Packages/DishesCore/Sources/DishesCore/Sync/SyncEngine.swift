// Drives the local store from the server and back — a port of
// packages/client/src/sync-engine.ts, which stays the reference. The comments
// there explain each rule; the ones here say where Swift differs.
//
// No timers and no network listeners: the app decides *when* to sync (launch,
// foreground, reconnect, background refresh, silent push) and calls `sync()`.
//
//   let engine = SyncEngine(store: store, transport: api)
//   let outcome = try await engine.sync()
//   try await engine.mutate("shopping_item.toggle", payload: .object(["itemId": .string(id), "checked": .bool(true)]),
//                           optimistic: [.put(.shoppingItems, toggled)])
//
// Conflicts are the server's business: last write wins per entity, and the
// next pull carries whatever it decided (API.md, "Sync").

import Foundation

public struct SyncOutcome: Equatable, Sendable {
    public var pulled = 0
    public var pushed = 0
    public var failed = 0
    /// True when the server couldn't be reached.
    public var offline = false
    /// True when this call was skipped because we're backing off.
    public var skipped = false

    public init(pulled: Int = 0, pushed: Int = 0, failed: Int = 0, offline: Bool = false, skipped: Bool = false) {
        self.pulled = pulled
        self.pushed = pushed
        self.failed = failed
        self.offline = offline
        self.skipped = skipped
    }
}

public actor SyncEngine {
    let store: LocalStore
    let transport: any SyncTransport
    let pageSize: Int
    let now: @Sendable () -> Date
    /// The server takes at most 200 mutations per push (lib/api/schemas/sync.ts).
    /// The web sends its whole queue; a phone that spent a week offline might not fit.
    static let pushBatch = 200

    private var onMutationsFailed: (@Sendable ([FailedMutation]) -> Void)?
    private var onError: (@Sendable (Error) -> Void)?
    private var inFlight: Task<SyncOutcome, Error>?

    // Backoff after a transport failure: 5s doubling to 5 minutes. A weak signal
    // (not no signal) is the case it's for — every request would otherwise hang
    // for the full timeout while competing for a few KB/s.
    static let backoffMin: TimeInterval = 5
    static let backoffMax: TimeInterval = 5 * 60
    private var backoff: TimeInterval = 0
    private var nextAttemptAt: Date = .distantPast

    public init(store: LocalStore, transport: any SyncTransport, pageSize: Int = 500,
                now: @escaping @Sendable () -> Date = { Date() }) {
        self.store = store
        self.transport = transport
        self.pageSize = pageSize
        self.now = now
    }

    /// Called once per batch the server refuses, after the rollback has landed.
    public func onMutationsFailed(_ handler: @escaping @Sendable ([FailedMutation]) -> Void) {
        onMutationsFailed = handler
    }

    /// Transport failures the person doesn't need to hear about, for logging.
    public func onError(_ handler: @escaping @Sendable (Error) -> Void) {
        onError = handler
    }

    public var isBackingOff: Bool { now() < nextAttemptAt }

    /// Push queued mutations, then pull, so the pull returns our own writes in
    /// their server form within the same cycle. Concurrent calls share one run.
    /// Throws only `APIError.signedOut`, which the app must act on.
    @discardableResult
    public func sync(force: Bool = false) async throws -> SyncOutcome {
        if let inFlight { return try await inFlight.value }
        if !force && isBackingOff { return SyncOutcome(offline: true, skipped: true) }

        let task = Task { try await run() }
        inFlight = task
        defer { inFlight = nil }
        return try await task.value
    }

    private func run() async throws -> SyncOutcome {
        var outcome = SyncOutcome()
        do {
            let pushed = try await drainQueue()
            outcome.pushed = pushed.pushed
            outcome.failed = pushed.failed
            outcome.pulled = try await pullAll()
            backoff = 0
            nextAttemptAt = .distantPast
        } catch APIError.signedOut {
            throw APIError.signedOut
        } catch {
            // An HTTP error means we reached the server, so the connection is
            // fine and backing off would only delay recovery.
            if case APIError.http = error {} else {
                backoff = backoff == 0 ? Self.backoffMin : min(backoff * 2, Self.backoffMax)
                nextAttemptAt = now().addingTimeInterval(backoff)
            }
            outcome.offline = true
            onError?(error)
        }
        return outcome
    }

    // MARK: Pull

    private func pullAll() async throws -> Int {
        var total = 0
        var guardCount = 0
        var reset = false

        while true {
            let cursor = try await store.read { try $0.cursor() }
            let page: PullResponse
            do {
                page = try await transport.pull(cursor: cursor, limit: pageSize)
            } catch APIError.http(_, "invalid_request", _) where cursor != nil && !reset {
                // A cursor the server won't take (pruned past, or a format
                // change) is recoverable once: drop the rows, keep the outbox,
                // take a fresh snapshot.
                reset = true
                try await store.write { try $0.clearRecords() }
                continue
            }

            try await store.write { try $0.applyPull(page) }
            total += SyncCollection.allCases.reduce(0) {
                $0 + page.changes(in: $1).count + page.deleted(in: $1).count
            }

            if !page.hasMore { break }
            // A server that always says hasMore would spin forever.
            guardCount += 1
            if guardCount > 200 { break }
        }
        return total
    }

    // MARK: Push

    private func drainQueue() async throws -> (pushed: Int, failed: Int) {
        var pushed = 0
        var failedCount = 0

        while true {
            let pending = try await store.read { try $0.pendingMutations() }
            guard !pending.isEmpty else { break }
            let batch = Array(pending.prefix(Self.pushBatch))

            let response = try await transport.push(batch)
            let byOpId = Dictionary(batch.map { ($0.opId, $0) }, uniquingKeysWith: { a, _ in a })

            // Applied and duplicate are both settled; failed is dropped rather
            // than retried (sync-engine.ts explains why), and reported.
            let settled = response.results.filter { $0.status != .failed }.map(\.opId)
            let failed = response.results.filter { $0.status == .failed }
            let reported = Set(response.results.map(\.opId))

            // Temporary rows go and the queue entries go in one transaction —
            // the web needs a careful order to survive a crash in between; here
            // there is no in between.
            try await store.write { tx in
                for result in response.results {
                    for row in byOpId[result.opId]?.temporary ?? [] { try tx.remove(row.collection, id: row.id) }
                }
                try tx.dequeue(settled + failed.map(\.opId))
            }

            pushed += settled.count
            failedCount += failed.count

            if !failed.isEmpty {
                let failures = failed.map { f in
                    let original = byOpId[f.opId]
                    return FailedMutation(opId: f.opId, type: original?.type ?? "unknown",
                                          payload: original?.payload ?? .object([:]),
                                          error: f.error ?? "Unknown error",
                                          queuedAt: original?.queuedAt ?? Int(now().timeIntervalSince1970 * 1000))
                }
                onMutationsFailed?(failures)
            }

            // A server that answered for none of the batch would loop forever.
            if batch.allSatisfy({ !reported.contains($0.opId) }) { break }
        }
        return (pushed, failedCount)
    }

    // MARK: Local writes

    /// Records a mutation locally and queues it. The optimistic changes and the
    /// queue entry are one transaction, so the screen never shows a change that
    /// isn't queued, or the other way round.
    @discardableResult
    public func mutate(_ type: String, payload: JSONValue, optimistic: [OptimisticChange] = []) async throws -> String {
        try await store.queueMutation(type, payload: payload, optimistic: optimistic, at: now())
    }

    /// Patches a record locally without queueing anything, for writes that go
    /// through a direct API call instead. The next pull overwrites it with the
    /// server's row, so use it only where the server's answer is a foregone
    /// conclusion.
    public func patchLocal(_ collection: SyncCollection, id: String, _ patch: [String: JSONValue]) async throws {
        try await store.write { tx in
            guard let existing = try tx.reader.record(collection, id: id) else { return }
            try tx.put(collection, existing.merging(.object(patch)).merging(.object(["id": .string(id)])))
        }
    }
}

extension LocalStore {
    /// `SyncEngine.mutate` without an engine, for a process that can't sync
    /// itself every time — a widget's button (DishesWidgets): the change and
    /// its queue entry in one transaction, sent by whichever process syncs next.
    @discardableResult
    public func queueMutation(_ type: String, payload: JSONValue, optimistic: [OptimisticChange] = [],
                              at date: Date = Date()) async throws -> String {
        let opId = UUID().uuidString.lowercased()
        let queuedAt = Int(date.timeIntervalSince1970 * 1000)
        try await write { tx in
            var temporary: [RecordRef] = []
            for change in optimistic {
                switch change {
                case .put(let collection, let record, let isTemporary):
                    try tx.put(collection, record)
                    if isTemporary, let id = record.id { temporary.append(RecordRef(collection, id)) }
                case .remove(let collection, let id):
                    try tx.remove(collection, id: id)
                }
            }
            try tx.enqueue(QueuedMutation(opId: opId, type: type, payload: payload, queuedAt: queuedAt,
                                          temporary: temporary))
        }
        return opId
    }

    /// Ticks a shopping item off (or back on): the shopping screen, the Watch,
    /// Siri and the Shopping widget all go through this. False when the item
    /// has gone (deleted on another device).
    @discardableResult
    public func setShoppingItem(_ id: String, checked: Bool) async throws -> Bool {
        guard let current = try await read({ try $0.record(.shoppingItems, id: id) }) else { return false }
        try await queueMutation("shopping_item.toggle", payload: .object(["itemId": .string(id), "checked": .bool(checked)]),
                                optimistic: [.put(.shoppingItems, current.merging(.object(["isChecked": .bool(checked)])))])
        return true
    }
}
