// The web app's pages that the app can show itself (TODO_MOBILE.md, C4
// "Handoff + universal links"). Both directions use the same URLs:
//
//   in   a Dishes link tapped in Messages or Mail opens here instead of
//        Safari (a universal link: the server's apple-app-site-association
//        claims these paths), as does a page handed off from the Mac's browser
//   out  the recipe, shopping list or planner on screen is offered to the
//        family's other devices (Handoff) with its web address, so a Mac — or
//        a device without the app — opens the same page in the browser
//
//   /recipes/{id}        the recipe (…/edit and …/print land on it too)
//   /recipes/{id}/cook   cooking mode for it
//   /shopping            the shopping list
//   /meal-plan           the planner
//   /home, /, /recipes   the recipes
//
// The paths are a contract with apps/web/app/.well-known/apple-app-site-association.

import Foundation
import SwiftUI

enum DishesLink: Equatable {
    case recipe(String)
    case cook(String)
    case shopping
    case plan
    case recipes

    /// The Handoff activity every screen advertises; its webpageURL says where.
    static let activityType = "uk.collco.dishes.page"

    init?(url: URL) {
        guard url.scheme == "https" || url.scheme == "http" else { return nil }
        let parts = url.path.split(separator: "/").map(String.init)
        switch parts.first {
        case nil, "home": self = .recipes
        case "recipes":
            guard parts.count > 1 else { self = .recipes; return }
            let id = parts[1]
            guard UUID(uuidString: id) != nil else { return nil } // /recipes/new and the like
            self = parts.count > 2 && parts[2] == "cook" ? .cook(id) : .recipe(id)
        case "shopping": self = .shopping
        case "meal-plan": self = .plan
        default: return nil
        }
    }

    /// The same page on the web app.
    @MainActor var webURL: URL {
        let path = switch self {
        case .recipe(let id): "recipes/\(id)"
        case .cook(let id): "recipes/\(id)/cook"
        case .shopping: "shopping"
        case .plan: "meal-plan"
        case .recipes: "recipes"
        }
        return AppModel.serverURL.appending(path: path)
    }
}

extension AppNav {
    func follow(_ link: DishesLink) {
        switch link {
        case .recipe(let id): openRecipe(id)
        case .cook(let id): AppRequests.shared.cook = .recipe(id)
        case .shopping: tab = .shopping
        case .plan: tab = .plan
        case .recipes: tab = .recipes
        }
    }
}

extension View {
    /// Offers this page to the household's other devices while it's on screen.
    func handoff(_ link: DishesLink, title: String, isActive: Bool = true) -> some View {
        userActivity(DishesLink.activityType, isActive: isActive) { activity in
            activity.title = title
            activity.webpageURL = link.webURL
            activity.isEligibleForHandoff = true
        }
    }
}
