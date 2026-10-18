// Types the app and the widget extension (DishesWidgets) both compile: what a
// Live Activity carries, and the metadata on a cooking timer's AlarmKit alarm.
// The extension can't see the app's code, so anything both sides read lives here.

import ActivityKit
import AlarmKit
import Foundation

/// The cooking Live Activity: the step you're on and the next timer to go off,
/// on the Lock Screen and in the Dynamic Island while cooking mode is open.
struct CookingActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// The dish being shown (a combined meal has several; this is the current tab).
        var dish: String
        /// 1-based.
        var step: Int
        var totalSteps: Int
        var instruction: String
        /// The soonest running timer, if any. The view counts down to `timerEndsAt`
        /// itself, so the app needn't update the activity every second.
        var timerLabel: String?
        var timerEndsAt: Date?
        /// How many timers are running, across every dish.
        var runningTimers: Int
        /// The cook in front's name. Several cooks can go at once, and the
        /// activity follows whichever is in front without being restarted;
        /// nil from an app that predates that, so `title` is used.
        var title: String? = nil
        /// Where a tap opens: this cook at this step (CookLink). nil from an
        /// app that predates it, and the tap just opens the app.
        var link: URL? = nil
    }

    /// The name of the cook the activity was started for: the meal's, or the
    /// recipe's when it's a single dish. `ContentState.title` takes over.
    var title: String
}

/// On each cooking timer's AlarmKit alarm (AlarmKit requires a metadata type).
/// The countdown on the Lock Screen is drawn by DishesWidgets from it.
struct CookTimerMetadata: AlarmMetadata {
    var dish: String?
}
