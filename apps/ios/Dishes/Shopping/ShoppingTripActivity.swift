// Starts the shopping-trip Live Activity (drawn by DishesWidgets) and hands its
// push token to the server, which updates it as anyone in the household adds
// or ticks things (apps/web/lib/shopping-trip-activities.ts). The app also
// redraws it after its own changes and syncs, so ticking in the app — or on
// the Lock Screen — shows at once, with or without APNs.
//
//   await ShoppingTripActivity.shared.start()
//   await ShoppingTripActivity.shared.update()   // after a local change or a sync

import ActivityKit
import DishesCore
import Foundation

@MainActor
final class ShoppingTripActivity {
    static let shared = ShoppingTripActivity()
    private var watching: Set<String> = []

    private init() {}

    var isShowing: Bool { Activity<ShoppingTripAttributes>.activities.contains { $0.activityState == .active } }

    /// The Lock Screen's tick buttons (TickTripItemIntent) land here, possibly
    /// with the app launched in the background just for them.
    func install() {
        TripTicks.handler = { id in
            let app = AppModel.shared
            await app.start()
            // Locked means backgrounded, where the store is suspended until woken.
            await app.awake {
                await app.setShoppingItem(id, checked: true) // redraws the trip too
                await app.syncNow()
            }
        }
    }

    /// Puts the list on the Lock Screen. Answers a reason when it can't.
    func start() async -> String? {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            return "Live Activities are turned off for Dishes in Settings."
        }
        guard let data = try? await AppModel.shared.store.read(ShoppingData.load), let list = data.list else {
            return "There’s no shopping list yet."
        }
        let state = ShoppingTripAttributes.ContentState(data)
        guard state.left > 0 else { return "Everything’s already in the basket." }
        end()
        do {
            let activity = try Activity.request(
                attributes: ShoppingTripAttributes(listId: list.id, listName: list.name),
                content: ActivityContent(state: state, staleDate: .now.addingTimeInterval(ShoppingTrip.lasts)),
                pushType: .token)
            watch(activity)
            return nil
        } catch {
            return "Couldn’t start the Live Activity: \(error.localizedDescription)"
        }
    }

    func end() {
        for activity in Activity<ShoppingTripAttributes>.activities {
            let box = Box(activity: activity)
            Task { await box.activity.end(nil, dismissalPolicy: .immediate) }
        }
    }

    /// Brings a running trip up to date from the device's copy of the list
    /// (ShoppingTrip.redraw), and makes sure the server has its token.
    func update() async {
        let running = Activity<ShoppingTripAttributes>.activities.filter { $0.activityState == .active }
        guard !running.isEmpty, let data = try? await AppModel.shared.store.read(ShoppingData.load) else { return }
        running.forEach(watch)
        await ShoppingTrip.redraw(data)
    }

    /// Sends the activity's push token to the server whenever it's issued.
    private func watch(_ activity: Activity<ShoppingTripAttributes>) {
        guard !watching.contains(activity.id) else { return }
        watching.insert(activity.id)
        let box = Box(activity: activity)
        let listId = activity.attributes.listId
        Task {
            for await data in box.activity.pushTokenUpdates {
                let token = data.map { String(format: "%02x", $0) }.joined()
                try? await AppModel.shared.api.registerShoppingTrip(listId: listId, token: token, sandbox: Push.sandbox)
            }
        }
    }
}

/// Activity isn't Sendable, but ActivityKit documents its methods as callable from any task.
private struct Box: @unchecked Sendable { let activity: Activity<ShoppingTripAttributes> }
