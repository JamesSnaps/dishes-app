// The shopping-trip Live Activity (TODO_MOBILE.md, C4): how many items are
// left and the next few in aisle order, on the Lock Screen while you're in the
// shop. Started from the shopping list; kept current by the server over APNs
// (apps/web/lib/shopping-trip-activities.ts) as anyone at home adds or ticks
// things, and by the app itself when it's the one ticking.
//
// ContentState is what the server sends as "content-state", so its keys are a
// contract with shoppingTripState() there.
//
// The Lock Screen's tick buttons run TickTripItemIntent, which ticks the item,
// redraws the activity and syncs. The system runs it in the app (launched in
// the background if need be) through the app's own path; if it lands in the
// widget extension instead — the simulator did that once — it does the same
// on the shared database directly.

import ActivityKit
import AppIntents
import DishesCore
import Foundation

struct ShoppingTripAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        struct Item: Codable, Hashable { var id: String; var name: String }

        var left: Int
        var total: Int
        var next: [Item]
    }

    var listId: String
    var listName: String
}

extension ShoppingTripAttributes.ContentState {
    /// The same rule as the server's shoppingTripState(): what's left, in
    /// aisle order, the first three by name.
    init(_ data: ShoppingData) {
        let open = data.groups.flatMap(\.items)
        self.init(left: open.count, total: data.all.count, next: open.prefix(3).map { Item(id: $0.id, name: $0.name) })
    }
}

enum ShoppingTrip {
    /// Forgotten after this long if the trip never finishes (the server's TTL too).
    static let lasts: TimeInterval = 12 * 60 * 60

    /// Brings running trips up to date with the device's copy of the list:
    /// ended when everything's ticked (left showing a while) or the list has
    /// been archived.
    static func redraw(_ data: ShoppingData) async {
        let state = ShoppingTripAttributes.ContentState(data)
        for activity in Activity<ShoppingTripAttributes>.activities where activity.activityState == .active {
            if data.list?.id != activity.attributes.listId {
                await activity.end(nil, dismissalPolicy: .immediate)
            } else if state.left == 0 {
                await activity.end(ActivityContent(state: state, staleDate: nil),
                                   dismissalPolicy: .after(.now.addingTimeInterval(15 * 60)))
            } else if state != activity.content.state {
                await activity.update(ActivityContent(state: state, staleDate: .now.addingTimeInterval(lasts)))
            }
        }
    }
}

struct TickTripItemIntent: LiveActivityIntent {
    static var title: LocalizedStringResource { "Tick Off Item" }
    static var isDiscoverable: Bool { false }

    @Parameter(title: "Item") var itemId: String

    init() {}
    init(itemId: String) { self.itemId = itemId }

    func perform() async throws -> some IntentResult {
        if let app = await TripTicks.handler {
            await app(itemId)
            return .result()
        }
        // The extension: the app's database in the group container, as the widgets read it.
        guard let url = AppGroup.databaseURL, FileManager.default.fileExists(atPath: url.path),
              let store = try? LocalStore(sharedPath: url.path),
              (try? await store.setShoppingItem(itemId, checked: true)) == true else { return .result() }
        if let data = try? await store.read(ShoppingData.load) { await ShoppingTrip.redraw(data) }
        if let api = ExtensionAPI.client() {
            // Long enough for the server to hear (and tell the family's devices); not forever.
            let engine = SyncEngine(store: store, transport: api)
            await withTaskGroup(of: Void.self) { group in
                group.addTask { _ = try? await engine.sync(force: true) }
                group.addTask { try? await Task.sleep(for: .seconds(8)) }
                await group.next()
                group.cancelAll()
            }
        }
        return .result()
    }
}

/// Set by the app at launch (ShoppingTripActivity), for when the intent runs
/// in the app's process: its own store, sync and screens.
@MainActor
enum TripTicks {
    static var handler: (@MainActor @Sendable (String) async -> Void)?
}
