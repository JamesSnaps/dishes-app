// Starts the meal-schedule Live Activity (drawn by DishesWidgets) and hands
// its push token to the server, which then updates it as each step comes due
// and ends it after serving (apps/web/lib/live-activities.ts). The app also
// refreshes it whenever it comes to the front, in case a push was missed.
//
//   await MealScheduleActivity.shared.start(groupId:)

import ActivityKit
import DishesCore
import Foundation

@MainActor
final class MealScheduleActivity {
    static let shared = MealScheduleActivity()
    private var watching: Set<String> = []

    private init() {}

    func isShowing(_ groupId: String) -> Bool {
        Activity<MealScheduleAttributes>.activities.contains { $0.attributes.groupId == groupId && $0.activityState == .active }
    }

    /// Shows the meal on the Lock Screen. Answers a reason when it can't.
    func start(groupId: String) async -> String? {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            return "Live Activities are turned off for Dishes in Settings."
        }
        let clock: APIClient.MealClock
        do {
            clock = try await AppModel.shared.api.mealClock(groupId: groupId)
        } catch {
            return "This meal needs a serve-at time first."
        }
        guard let state = Self.state(clock, now: .now) else { return "Everything in this meal is already done." }
        end(groupId)
        do {
            let activity = try Activity.request(
                attributes: MealScheduleAttributes(groupId: groupId, title: clock.title),
                content: ActivityContent(state: state, staleDate: Date(timeIntervalSince1970: state.serveAt + 30 * 60)),
                pushType: .token)
            watch(activity)
            return nil
        } catch {
            return "Couldn’t start the Live Activity: \(error.localizedDescription)"
        }
    }

    func end(_ groupId: String) {
        for activity in Activity<MealScheduleAttributes>.activities where activity.attributes.groupId == groupId {
            let box = Box(activity: activity)
            Task { await box.activity.end(nil, dismissalPolicy: .immediate) }
        }
    }

    /// On becoming active: bring every running meal activity up to date, and
    /// make sure the server has each one's token (it may have restarted).
    func refresh() async {
        for activity in Activity<MealScheduleAttributes>.activities where activity.activityState == .active {
            watch(activity)
            guard let clock = try? await AppModel.shared.api.mealClock(groupId: activity.attributes.groupId) else { continue }
            let box = Box(activity: activity)
            if let state = Self.state(clock, now: .now), Date.now.timeIntervalSince1970 < clock.serveAt / 1000 + 30 * 60 {
                await box.activity.update(ActivityContent(state: state, staleDate: Date(timeIntervalSince1970: state.serveAt + 30 * 60)))
            } else {
                await box.activity.end(nil, dismissalPolicy: .immediate)
            }
        }
    }

    /// Sends the activity's push token to the server whenever it's issued.
    private func watch(_ activity: Activity<MealScheduleAttributes>) {
        guard !watching.contains(activity.id) else { return }
        watching.insert(activity.id)
        let box = Box(activity: activity)
        let groupId = activity.attributes.groupId
        Task {
            for await data in box.activity.pushTokenUpdates {
                let token = data.map { String(format: "%02x", $0) }.joined()
                try? await AppModel.shared.api.registerLiveActivity(groupId: groupId, token: token, sandbox: Push.sandbox)
            }
        }
    }

    /// The same rule as the server's liveActivityState(): the next step not
    /// more than a minute past, then the one after it.
    static func state(_ clock: APIClient.MealClock, now: Date) -> MealScheduleAttributes.ContentState? {
        let nowMs = now.timeIntervalSince1970 * 1000
        let upcoming = clock.cues.filter { $0.id != "serve" && $0.at > nowMs - 60_000 }
        let line = { (c: APIClient.MealClock.Cue) in c.dish.map { "\($0): \(c.text)" } ?? c.text }
        if upcoming.isEmpty && nowMs > clock.serveAt + 30 * 60_000 { return nil }
        return MealScheduleAttributes.ContentState(
            nextAt: (upcoming.first?.at ?? clock.serveAt) / 1000,
            nextText: upcoming.first.map(line) ?? "Serve",
            afterText: upcoming.dropFirst().first.map(line),
            serveAt: clock.serveAt / 1000,
            stepsLeft: upcoming.count)
    }
}

/// Activity isn't Sendable, but ActivityKit documents its methods as callable from any task.
private struct Box: @unchecked Sendable { let activity: Activity<MealScheduleAttributes> }
