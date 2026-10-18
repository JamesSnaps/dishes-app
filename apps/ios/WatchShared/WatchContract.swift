// What the phone and the Watch say to each other over WatchConnectivity.
// Compiled into the iPhone app, the Watch app and the Watch's widgets
// (project.yml). The Watch never talks to the server: the phone holds the
// sign-in and the database, and the Watch shows a copy (RUNBOOK.md, "Apple Watch").
//
//   phone → watch  updateApplicationContext([WatchKeys.snapshot: Data])   the latest WatchSnapshot; only the newest matters
//   watch → phone  sendMessage([WatchKeys.action: Data]), or transferUserInfo when the phone can't be reached
//                  — a WatchAction, queued until the phone has it
//   watch → phone  sendMessage([WatchKeys.refresh: "all" | "cooking"]), replied to with a fresh snapshot
//
// A WatchAction has its own id, and the snapshot lists the ids the phone has
// applied lately, so the Watch keeps showing its change until the phone's copy
// includes it and an action sent twice is applied once.

import Foundation

/// Everything the Watch shows, as the phone last saw it.
struct WatchSnapshot: Codable, Equatable, Sendable {
    /// False when nobody is signed in on the phone: the Watch says to open Dishes there.
    var signedIn: Bool
    var listName: String?
    /// The active shopping list, unticked first in aisle order, then ticked.
    var items: [WatchItem]
    var tonight: WatchMeal?
    /// Cooks in progress in the household: this phone's own, and any on other
    /// devices (the kitchen iPad) from the server's shared cooking sessions.
    var cooking: [WatchCook]
    /// Ids of the WatchActions the phone has applied lately (at most `appliedLimit`).
    var applied: [String]
    /// When the phone last finished a sync with the server.
    var syncedAt: Date?
    /// When the phone made this snapshot.
    var madeAt: Date

    static let appliedLimit = 100
    static let empty = WatchSnapshot(signedIn: false, listName: nil, items: [], tonight: nil, cooking: [],
                                     applied: [], syncedAt: nil, madeAt: .distantPast)

    var openCount: Int { items.filter { !$0.checked }.count }
}

struct WatchItem: Codable, Equatable, Hashable, Identifiable, Sendable {
    var id: String
    var name: String
    /// "2 kg", "" when there's no amount.
    var quantity: String
    /// The aisle group the phone shows it in ("Produce", "Uncategorised").
    var category: String
    var checked: Bool
}

/// Tonight's planned meal.
struct WatchMeal: Codable, Equatable, Sendable {
    var title: String
    var dishes: [String]
    /// When it's planned to be on the table, if the meal has a serve-at time.
    var serveAt: Date?
    /// The meal's cooking schedule ("Potatoes in"), earliest first.
    var cues: [WatchCue]
}

struct WatchCue: Codable, Equatable, Hashable, Sendable {
    var at: Date
    var dish: String?
    var text: String
}

/// A cook in progress, on this phone or another device.
struct WatchCook: Codable, Equatable, Identifiable, Sendable {
    var id: String
    var title: String
    /// Where it's being cooked: "iPad", "iPhone", or "this iPhone".
    var device: String
    var dish: String
    /// 1-based.
    var step: Int
    var totalSteps: Int
    var instruction: String
    var timers: [WatchTimer]
    /// When the cooking device last said anything about it.
    var updatedAt: Date
}

struct WatchTimer: Codable, Equatable, Hashable, Identifiable, Sendable {
    enum State: String, Codable, Sendable { case running, paused, finished }

    var id: String
    var label: String
    var dish: String?
    /// When it goes off, while running. Absolute, so a late update still counts down right.
    var endsAt: Date?
    /// Seconds left when paused.
    var remaining: TimeInterval
    /// The whole length in seconds, for a progress ring.
    var duration: TimeInterval?
    var state: State

    func secondsLeft(at now: Date = .now) -> TimeInterval {
        switch state {
        case .running: max(0, (endsAt ?? now).timeIntervalSince(now))
        case .paused: remaining
        case .finished: 0
        }
    }
}

/// Something done on the Watch, for the phone to save.
struct WatchAction: Codable, Equatable, Identifiable, Sendable {
    enum Kind: String, Codable, Sendable { case toggle, add }

    var id: String
    var kind: Kind
    /// The item ticked, or the new item's id (the server keeps a client-made id).
    var itemId: String
    /// `add`: the item as typed or spoken.
    var name: String?
    /// `toggle`: ticked or not.
    var checked: Bool?
    var at: Date

    static func toggle(_ itemId: String, checked: Bool) -> WatchAction {
        WatchAction(id: UUID().uuidString.lowercased(), kind: .toggle, itemId: itemId, name: nil, checked: checked, at: .now)
    }

    static func add(_ name: String) -> WatchAction {
        WatchAction(id: UUID().uuidString.lowercased(), kind: .add, itemId: UUID().uuidString.lowercased(),
                    name: name, checked: nil, at: .now)
    }
}

enum WatchKeys {
    static let snapshot = "snapshot"
    static let action = "action"
    static let refresh = "refresh"
}

enum WatchCoding {
    static func encode(_ value: some Encodable) -> Data? { try? encoder.encode(value) }
    static func decode<T: Decodable>(_ type: T.Type, from data: Any?) -> T? {
        (data as? Data).flatMap { try? decoder.decode(type, from: $0) }
    }

    private static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .millisecondsSince1970
        return e
    }()
    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .millisecondsSince1970
        return d
    }()
}

/// The Watch's copy of the snapshot, shared with its widgets through the App Group.
enum WatchStore {
    static let group = "group.uk.collco.dishes.watch"

    static var url: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?
            .appendingPathComponent("snapshot.json")
    }

    static func load() -> WatchSnapshot? {
        guard let url, let data = try? Data(contentsOf: url) else { return nil }
        return WatchCoding.decode(WatchSnapshot.self, from: data)
    }

    static func save(_ snapshot: WatchSnapshot) {
        guard let url, let data = WatchCoding.encode(snapshot) else { return }
        try? data.write(to: url, options: .atomic)
    }
}
