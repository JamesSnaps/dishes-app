// The meal-schedule Live Activity: tonight's meal's next step and when to do
// it, counting down on the Lock Screen. Started by the app from the meal page;
// kept current by the server over APNs (apps/web/lib/live-activities.ts) as
// each step comes due, so the app needn't be running.
//
// ContentState is what the server sends as "content-state", so its keys and
// types are a contract with liveActivityState() there: times are Unix seconds
// as plain numbers (ActivityKit's default Date decoding isn't Unix time).

import ActivityKit
import Foundation

struct MealScheduleAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// When to do the next step, Unix seconds.
        var nextAt: Double
        /// "Mushroom Risotto: Brown the mushrooms…", or "Serve".
        var nextText: String
        var afterText: String?
        /// When everything should be ready, Unix seconds.
        var serveAt: Double
        var stepsLeft: Int

        var nextDate: Date { Date(timeIntervalSince1970: nextAt) }
        var serveDate: Date { Date(timeIntervalSince1970: serveAt) }
    }

    var groupId: String
    var title: String
}
