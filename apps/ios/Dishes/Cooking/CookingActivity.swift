// Drives the cooking Live Activity (drawn by DishesWidgets): started when
// cooking mode opens, updated when the step, the timers or the cook in front
// change, ended when the last cook does. Between updates the Lock Screen counts the next timer down by
// itself, so nothing here runs while the device is locked.
//
//   CookingActivity.shared.show(title:dish:step:of:instruction:link:)
//   CookingActivity.shared.end()

import ActivityKit
import Foundation

@MainActor
final class CookingActivity {
    static let shared = CookingActivity()
    private var activity: Activity<CookingActivityAttributes>?
    private var last: CookingActivityAttributes.ContentState?

    /// Starts the activity, or updates the running one. Quietly does nothing
    /// when Live Activities are turned off for Dishes in Settings.
    func show(title: String, dish: String, step: Int, of total: Int, instruction: String, link: URL? = nil) {
        let next = CookTimers.shared.timers
            .filter { $0.state == .running }
            .min { ($0.endsAt ?? .distantFuture) < ($1.endsAt ?? .distantFuture) }
        let state = CookingActivityAttributes.ContentState(
            dish: dish, step: step, totalSteps: total, instruction: instruction,
            timerLabel: next?.label, timerEndsAt: next?.endsAt,
            runningTimers: CookTimers.shared.timers.filter { $0.state == .running }.count,
            title: title, link: link)
        guard state != last else { return }
        // Stale once the timer it shows has gone off, so the system greys it
        // rather than showing a frozen 0:00 as if current.
        let content = ActivityContent(state: state, staleDate: next?.endsAt?.addingTimeInterval(60))

        // Another cook come to the front is an update too: starting an
        // activity holds the main thread for a moment, switching mustn't.
        if let activity, activity.activityState == .active {
            last = state
            let box = ActivityBox(activity: activity)
            Task { await box.activity.update(content) }
            return
        }
        end()
        last = state
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        activity = try? Activity.request(attributes: CookingActivityAttributes(title: title), content: content)
    }

    /// After a relaunch: take back the activity the last run left on the Lock
    /// Screen (the cooks came back too), ending any others.
    func adoptLeftover() {
        guard activity == nil else { return }
        let leftovers = Activity<CookingActivityAttributes>.activities.filter { $0.activityState == .active }
        activity = leftovers.first
        for extra in leftovers.dropFirst() {
            let box = ActivityBox(activity: extra)
            Task { await box.activity.end(nil, dismissalPolicy: .immediate) }
        }
    }

    /// After a relaunch with no cook to come back to: nothing left showing one.
    func endLeftovers() {
        guard activity == nil else { return }
        for leftover in Activity<CookingActivityAttributes>.activities {
            let box = ActivityBox(activity: leftover)
            Task { await box.activity.end(nil, dismissalPolicy: .immediate) }
        }
    }

    func end() {
        last = nil
        guard let activity else { return }
        self.activity = nil
        let box = ActivityBox(activity: activity)
        Task { await box.activity.end(nil, dismissalPolicy: .immediate) }
    }
}

/// Activity isn't marked Sendable, but ActivityKit documents its update and end
/// as callable from any task.
private struct ActivityBox: @unchecked Sendable { let activity: Activity<CookingActivityAttributes> }
