// Drives the cooking Live Activity (drawn by DishesWidgets): started when
// cooking mode opens, updated when the step or the timers change, ended when
// it closes. Between updates the Lock Screen counts the next timer down by
// itself, so nothing here runs while the device is locked.
//
//   CookingActivity.shared.show(title:dish:step:of:instruction:)
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
    func show(title: String, dish: String, step: Int, of total: Int, instruction: String) {
        let next = CookTimers.shared.timers
            .filter { $0.state == .running }
            .min { ($0.endsAt ?? .distantFuture) < ($1.endsAt ?? .distantFuture) }
        let state = CookingActivityAttributes.ContentState(
            dish: dish, step: step, totalSteps: total, instruction: instruction,
            timerLabel: next?.label, timerEndsAt: next?.endsAt,
            runningTimers: CookTimers.shared.timers.filter { $0.state == .running }.count)
        guard state != last else { return }
        // Stale once the timer it shows has gone off, so the system greys it
        // rather than showing a frozen 0:00 as if current.
        let content = ActivityContent(state: state, staleDate: next?.endsAt?.addingTimeInterval(60))

        if let activity, activity.activityState == .active, activity.attributes.title == title {
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
