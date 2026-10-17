// Sign-in, or the app shell: the native floating tab bar — Liquid Glass,
// across the top on iPad (its sidebar button turns it into a sidebar) and at
// the bottom on iPhone. The screens themselves follow the web's design; the
// chrome around them follows the platform's (James, 17 Oct 2026: "adopt the
// design language of the iPad").
//
// The shopping count is a badge on its tab, as the web shows it in its sidebar.
// When something is planned for tonight, a "Cook tonight" pill sits above the
// tab bar (the tab bar's bottom accessory) — the web's orange middle button.
//
//   RootView()   // DishesApp's only scene content

import DishesCore
import SwiftUI

/// Which screen is showing, plus the cross-screen jumps the web does with
/// links ("See all" on Home opens Recipes filtered to favourites).
@MainActor @Observable
final class AppNav {
    enum Tab: String, CaseIterable { case home, recipes, plan, shopping, more }

    var tab: Tab = Tab(rawValue: UserDefaults.standard.string(forKey: "tab") ?? "") ?? .home {
        didSet { UserDefaults.standard.set(tab.rawValue, forKey: "tab") }
    }
    var favouritesOnly = false
    var recipeSearch = ""
    var cooking: CookRequest?

    func showRecipes(favourites: Bool = false, search: String = "") {
        favouritesOnly = favourites
        recipeSearch = search
        tab = .recipes
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var width
    @State private var nav = AppNav()

    var body: some View {
        Group {
            switch app.phase {
            case .starting:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity).background(Theme.background)
            case .signedOut:
                SignInView()
            case .ready:
                shell
            }
        }
        .environment(nav)
        .overlay(alignment: .bottom) { ToastView() }
        // A finished timer rings wherever you are in the app, not only in cooking mode.
        .overlay(alignment: .top) { RingingBanner() }
        .fullScreenCover(item: $nav.cooking) { CookingView(request: $0) }
        .task { await app.start() }
    }

    @State private var shoppingCount = Observed(0)
    @State private var tonight = Observed<CookRequest?>(nil)

    private var shell: some View {
        @Bindable var nav = nav
        return TabView(selection: $nav.tab) {
            Tab("Home", systemImage: "house", value: AppNav.Tab.home) { HomeScreen() }
            Tab("Recipes", systemImage: "book", value: AppNav.Tab.recipes) { RecipesScreen() }
            Tab("Planner", systemImage: "calendar", value: AppNav.Tab.plan) { PlanScreen() }
            Tab("Shopping", systemImage: "cart", value: AppNav.Tab.shopping) { ShoppingScreen() }
                .badge(shoppingCount.value)
            Tab("Settings", systemImage: "gearshape", value: AppNav.Tab.more) { MoreScreen() }
        }
        .tabViewStyle(.sidebarAdaptable)
        .tint(Theme.brand)
        .tabViewBottomAccessory(isEnabled: tonight.value != nil) {
            if let request = tonight.value { CookTonightPill(request: request) }
        }
        .task {
            await shoppingCount.follow(app.store) { r in
                let lists = try r.records(.shoppingLists).compactMap(ShoppingList.init)
                guard let active = lists.first(where: { $0.status == "active" }) else { return 0 }
                return try r.records(.shoppingItems).compactMap(ShoppingItem.init)
                    .filter { $0.listId == active.id && !$0.isChecked }.count
            }
        }
        .task { await tonight.follow(app.store, TonightMeal.load) }
    }
}

/// "🍳 Cook tonight · Greek Salad" above the tab bar; opens cooking mode.
struct CookTonightPill: View {
    @Environment(AppNav.self) private var nav
    let request: CookRequest

    var body: some View {
        Button { nav.cooking = request } label: {
            HStack(spacing: 10) {
                Image(systemName: "frying.pan.fill")
                    .foregroundStyle(.white)
                    .frame(width: 28, height: 28)
                    .background(Theme.brand, in: Circle())
                Text("Cook tonight").font(.system(size: 14, weight: .semibold))
                Text(request.title ?? request.dishes.first?.recipe.title ?? "")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.mutedForeground)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.mutedForeground)
            }
            .padding(.horizontal, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// "↻ Syncing…" / "✓ Up to date" — the web's SyncStatus line.
struct SyncLine: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
            Text(text)
        }
        .font(.system(size: 12))
        .foregroundStyle(Theme.mutedForeground)
    }

    private var icon: String {
        switch app.status.state {
        case .syncing, .starting: "arrow.triangle.2.circlepath"
        case .idle: app.status.pending > 0 ? "clock" : "checkmark.circle"
        case .offline: "wifi.slash"
        }
    }

    private var text: String {
        switch app.status.state {
        case .syncing, .starting: "Syncing…"
        case .idle: app.status.pending > 0 ? "\(app.status.pending) waiting to send" : "Up to date"
        case .offline: app.online ? "Can’t reach the server" : "Offline"
        }
    }
}

/// Initials on brand orange (the web's avatar fallback).
struct Avatar: View {
    let name: String
    var size: CGFloat = 40

    var body: some View {
        let initials = name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
        Text(initials.isEmpty ? "?" : initials)
            .font(.system(size: size * 0.36, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(Theme.brand, in: Circle())
    }
}

/// Tonight's meal, ready to cook: today's dinner (or the latest meal planned
/// for today), every dish of a combined meal together.
enum TonightMeal {
    @Sendable static func load(_ r: StoreReader) throws -> CookRequest? {
        let data = try PlanData.load(r)
        let week = Week.containing(Date())
        let today = (Calendar(identifier: .iso8601).component(.weekday, from: Date()) + 5) % 7
        let meals = data.meals(on: today, in: week)
        guard let meal = meals.first(where: { $0.mealType == "dinner" }) ?? meals.last else { return nil }
        let dishes = meal.dishes.compactMap(\.recipe).filter { !$0.steps.isEmpty }.map { CookDish(recipe: $0) }
        return dishes.isEmpty ? nil : CookRequest(title: meal.title, dishes: dishes)
    }
}

/// The app's one-line messages, dismissed after a few seconds.
struct ToastView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        if let message = app.toast {
            Text(message)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Theme.foreground)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .card()
                .shadow(color: .black.opacity(0.12), radius: 10, y: 4)
                .padding(.bottom, 150) // clear of the tab bar and the Cook tonight pill
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .task(id: message) {
                    try? await Task.sleep(for: .seconds(4))
                    withAnimation { app.toast = nil }
                }
        }
    }
}

/// Observes a query on the local store and keeps the latest result, so every
/// screen reads from the device and updates itself when sync writes.
///
///   @State private var items = Observed<[ShoppingItem]>([])
///   .task { await items.follow(app.store) { r in try r.records(.shoppingItems).compactMap(ShoppingItem.init) } }
@MainActor @Observable
final class Observed<Value: Sendable> {
    var value: Value
    private(set) var loaded = false

    init(_ initial: Value) { value = initial }

    func follow(_ store: LocalStore, _ fetch: @Sendable @escaping (StoreReader) throws -> Value) async {
        do {
            for try await next in store.observe(fetch) {
                value = next
                loaded = true
            }
        } catch {
            loaded = true
        }
    }
}
