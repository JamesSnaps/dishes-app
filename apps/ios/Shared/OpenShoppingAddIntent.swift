// The Control Center / Lock Screen "Add to Shopping" control's action, so it's
// compiled into the app and the widget extension both: the control lives in
// the extension, but an intent that opens the app runs in the app's process.
// There it leaves a request that RootView picks up — the Shopping tab with the
// add field focused (AddItemCard).
//
// A control can't ask for text, so this opens the app. Adding without opening
// it (Siri, Shortcuts, the Action button) is AddToShoppingListIntent.

import AppIntents
import Observation

struct OpenShoppingAddIntent: AppIntent {
    static var title: LocalizedStringResource { "Open Shopping List to Add" }
    static var description: IntentDescription { "Opens Dishes on the shopping list, ready to type an item." }
    static var openAppWhenRun: Bool { true }
    // Shortcuts has AddToShoppingListIntent; this one is only for the control.
    static var isDiscoverable: Bool { false }

    @MainActor
    func perform() async throws -> some IntentResult {
        AppRequests.shared.shoppingAdd = true
        return .result()
    }
}

/// Requests from outside the app's screens (a control), for RootView to act on and clear.
@MainActor @Observable
final class AppRequests {
    static let shared = AppRequests()
    var shoppingAdd = false
}
