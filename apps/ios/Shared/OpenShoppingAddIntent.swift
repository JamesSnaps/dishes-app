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

/// Requests from outside the app's screens (a control, Siri), for RootView to act on and clear.
@MainActor @Observable
final class AppRequests {
    static let shared = AppRequests()
    var shoppingAdd = false
    /// "Start cooking …": cooking mode for this (Dishes/Intents/DishesIntents.swift).
    var cook: CookIntentRequest?
    /// "What's for dinner?": the planner on this week.
    var showPlan = false
    /// The Shopping widget: the shopping list.
    var showShopping = false
    /// A recipe tapped in Spotlight or Shortcuts (OpenRecipeIntent).
    var openRecipe: String?
}

enum CookIntentRequest: Equatable {
    /// Tonight's meal, every dish of it.
    case tonight
    /// Today's meal of this type (the Tonight widget set to lunch, say).
    case today(mealType: String)
    case recipe(String)
}

/// Where a tap on a Home Screen widget goes (DishesWidgets/HomeWidgets.swift):
///
///   dishes://widget/cook?meal=dinner   cooking mode for today's dinner
///   dishes://widget/plan               the planner, this week
///   dishes://widget/shopping           the shopping list
enum WidgetLink: Equatable {
    case cook(mealType: String)
    case plan
    case shopping

    var url: URL {
        switch self {
        case .cook(let meal): URL(string: "dishes://widget/cook?meal=\(meal)")!
        case .plan: URL(string: "dishes://widget/plan")!
        case .shopping: URL(string: "dishes://widget/shopping")!
        }
    }

    init?(url: URL) {
        guard url.scheme == "dishes", url.host == "widget" else { return nil }
        switch url.path {
        case "/cook":
            let meal = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "meal" }?.value
            self = .cook(mealType: meal ?? "dinner")
        case "/plan": self = .plan
        case "/shopping": self = .shopping
        default: return nil
        }
    }

    /// Hands the link to RootView, as Siri's requests are.
    @MainActor func request() {
        switch self {
        case .cook(let meal): AppRequests.shared.cook = .today(mealType: meal)
        case .plan: AppRequests.shared.showPlan = true
        case .shopping: AppRequests.shared.showShopping = true
        }
    }
}
