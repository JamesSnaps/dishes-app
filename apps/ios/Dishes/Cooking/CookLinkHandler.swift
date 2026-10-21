// A tap on the cooking Live Activity (Lock Screen or Dynamic Island) opens
// its widgetURL, a CookLink (Shared/CookLink.swift): cooking mode for that
// cook, in front of any others, at the step the activity was showing. The
// other ways in land here too: widget links, Shortcut imports, universal links
// and Handoff (DishesLink).
//
// From a cold launch the link arrives before the cooks saved at the last
// launch are back (AppNav.restoreCooks), so it's held until they are.
//
//   RootView: .modifier(CookLinkHandler(nav: nav))

import SwiftUI

struct CookLinkHandler: ViewModifier {
    let nav: AppNav
    @State private var pending: CookLink?

    func body(content: Content) -> some View {
        content
            .onOpenURL { url in
                if let link = CookLink(url: url) {
                    pending = link
                } else if let widget = WidgetLink(url: url) {
                    widget.request()
                } else if let page = WebImportLink(url: url) {
                    // A recipe page from a Shortcut (Recipes/WebImportSheet.swift).
                    nav.importLink = page
                } else if let link = DishesLink(url: url) {
                    // A universal link: a Dishes page tapped in Messages or Mail.
                    nav.follow(link)
                }
            }
            // A page handed off from another device's Dishes, or its browser.
            .onContinueUserActivity(DishesLink.activityType) { follow($0) }
            .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { follow($0) }
            .onChange(of: pending == nil || !nav.cooksRestored, initial: true) { _, waiting in
                guard !waiting, let link = pending else { return }
                pending = nil
                nav.follow(link)
            }
    }
}

extension CookLinkHandler {
    private func follow(_ activity: NSUserActivity) {
        guard let url = activity.webpageURL, let link = DishesLink(url: url) else { return }
        nav.follow(link)
    }
}

extension AppNav {
    /// The link's cook in cooking mode at its step; with that cook ended since,
    /// its recipe (or, for a meal's schedule, the Planner).
    func follow(_ link: CookLink) {
        guard let cook = sessions.first(where: { $0.matches(link) }) else {
            if let id = link.recipeId ?? link.recipeIds.first {
                cookingShown = false
                openRecipe(id)
            } else {
                tab = .plan
            }
            return
        }
        cook.go(to: link)
        // The cookbook is a full-screen cover too; cooking mode can't come up over it.
        if book != nil {
            book = nil
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(450))
                open(cook)
            }
        } else {
            open(cook)
        }
    }
}
