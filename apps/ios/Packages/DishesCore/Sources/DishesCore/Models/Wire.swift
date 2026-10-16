// The /api/v1 sync wire format — the Swift twin of packages/client/src/types.ts.
// Records travel as whole server rows (JSONValue); Entities.swift reads typed
// fields out of them.
//
//   GET  /api/v1/sync?cursor=…&limit=…  → PullResponse
//   POST /api/v1/sync {mutations: […]}  → PushResponse

import Foundation

/// The entity groupings the sync endpoint returns. Raw values are the response keys.
public enum SyncCollection: String, CaseIterable, Codable, Hashable, Sendable {
    case recipes
    case shoppingLists
    case shoppingItems
    case mealPlans
    case mealPlanEntries
    case mealPlanGroups
    case cookHistory
    /// Saved meals, whole (meal + components + slots + options). Stored now;
    /// the planner's picker reads them next.
    case meals
}

public struct PullResponse: Decodable, Sendable {
    public var cursor: String
    public var hasMore: Bool
    /// Keyed by `SyncCollection.rawValue`. Kept as strings so a collection this
    /// build doesn't know about is ignored rather than failing the whole pull.
    public var changes: [String: [JSONValue]]
    public var deleted: [String: [String]]

    public init(cursor: String, hasMore: Bool, changes: [String: [JSONValue]] = [:], deleted: [String: [String]] = [:]) {
        self.cursor = cursor
        self.hasMore = hasMore
        self.changes = changes
        self.deleted = deleted
    }

    public func changes(in collection: SyncCollection) -> [JSONValue] { changes[collection.rawValue] ?? [] }
    public func deleted(in collection: SyncCollection) -> [String] { deleted[collection.rawValue] ?? [] }
}

public enum MutationStatus: String, Codable, Sendable {
    case applied, duplicate, failed
}

public struct MutationResult: Codable, Hashable, Sendable {
    public var opId: String
    public var status: MutationStatus
    public var error: String?
    /// Server-assigned id, when the mutation created something.
    public var id: String?

    public init(opId: String, status: MutationStatus, error: String? = nil, id: String? = nil) {
        self.opId = opId
        self.status = status
        self.error = error
        self.id = id
    }
}

public struct PushResponse: Codable, Sendable {
    public var results: [MutationResult]
    public var cursor: String

    public init(results: [MutationResult], cursor: String) {
        self.results = results
        self.cursor = cursor
    }
}

/// A row in a collection, by id.
public struct RecordRef: Codable, Hashable, Sendable {
    public var collection: SyncCollection
    public var id: String

    public init(_ collection: SyncCollection, _ id: String) {
        self.collection = collection
        self.id = id
    }
}

/// A queued mutation. `type` and `payload` mirror POST /api/v1/sync.
public struct QueuedMutation: Hashable, Sendable {
    public var opId: String
    public var type: String
    public var payload: JSONValue
    /// Unix ms, when the person actually did it.
    public var queuedAt: Int
    /// Client-generated ids written optimistically for rows the server owns.
    /// Removed once the mutation settles, whatever the outcome: on success the
    /// server's real row arrives in the same cycle's pull, on failure it's the
    /// rollback. (types.ts, `QueuedMutation.temporary`, has the full reasoning.)
    public var temporary: [RecordRef]

    public init(opId: String, type: String, payload: JSONValue, queuedAt: Int, temporary: [RecordRef] = []) {
        self.opId = opId
        self.type = type
        self.payload = payload
        self.queuedAt = queuedAt
        self.temporary = temporary
    }
}

/// One optimistic local write to apply alongside a mutation.
public enum OptimisticChange: Sendable {
    /// Write a record. `temporary` marks one the server will really create
    /// under its own id, so the placeholder must go when the mutation settles.
    case put(SyncCollection, JSONValue, temporary: Bool = false)
    case remove(SyncCollection, id: String)
}

/// A mutation the server refused. Its optimistic change has already been
/// rolled back; the host's job is to say what just undid itself.
public struct FailedMutation: Hashable, Sendable {
    public var opId: String
    public var type: String
    public var payload: JSONValue
    /// The server's message. Not written for end users.
    public var error: String
    public var queuedAt: Int
}

/// GET /api/v1/auth/whoami
public struct WhoAmI: Codable, Hashable, Sendable {
    public struct User: Codable, Hashable, Sendable {
        public var username: String
        public var displayName: String
        public var groups: [String]
    }

    public struct Household: Codable, Hashable, Sendable {
        public var householdId: String
        public var memberId: String
        public var role: String
    }

    public var transport: String
    public var user: User
    public var household: Household
}
