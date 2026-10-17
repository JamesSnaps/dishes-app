// Sign-in, or the app shell — laid out as the web app is:
//
//   iPad (regular width)   the web's desktop sidebar: logo, Home, Recipes, Meal
//                          Planner, Shopping List, a Personal section, then
//                          settings and the signed-in person at the bottom
//   iPhone (compact)       the web's mobile bottom bar: Home, Recipes, a raised
//                          orange button in the middle, Planner, Shopping
//
// Every screen stays alive when you switch (a ZStack, not a rebuilt view), so
// a recipe you opened is still open when you come back — as tabs behave.
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

    @ViewBuilder private var shell: some View {
        if width == .regular {
            HStack(spacing: 0) {
                Sidebar()
                Rectangle().fill(Theme.border).frame(width: 1).ignoresSafeArea()
                screens
            }
            .background(Theme.background)
        } else {
            screens
                .safeAreaInset(edge: .bottom, spacing: 0) { BottomBar() }
        }
    }

    private var screens: some View {
        ZStack {
            screen(.home) { HomeScreen() }
            screen(.recipes) { RecipesScreen() }
            screen(.plan) { PlanScreen() }
            screen(.shopping) { ShoppingScreen() }
            screen(.more) { MoreScreen() }
        }
        .background(Theme.background)
    }

    private func screen(_ tab: AppNav.Tab, @ViewBuilder _ content: () -> some View) -> some View {
        content()
            .opacity(nav.tab == tab ? 1 : 0)
            .allowsHitTesting(nav.tab == tab)
            .accessibilityHidden(nav.tab != tab)
    }
}

// MARK: iPad sidebar (components/nav, desktop)

struct Sidebar: View {
    @Environment(AppModel.self) private var app
    @Environment(AppNav.self) private var nav
    @State private var shoppingCount = Observed(0)

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "fork.knife")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Theme.brand)
                Text("Dishes").font(.system(size: 19, weight: .bold)).foregroundStyle(Theme.foreground)
            }
            .padding(.horizontal, 18)
            .padding(.top, 14)
            .padding(.bottom, 18)

            VStack(spacing: 2) {
                item("Home", icon: "house", tab: .home)
                item("Recipes", icon: "book", tab: .recipes)
                item("Meal Planner", icon: "calendar", tab: .plan)
                item("Shopping List", icon: "cart", tab: .shopping, count: shoppingCount.value)
            }
            .padding(.horizontal, 10)

            Text("PERSONAL")
                .font(.system(size: 11, weight: .semibold))
                .tracking(0.6)
                .foregroundStyle(Theme.mutedForeground)
                .padding(.horizontal, 22)
                .padding(.top, 22)
                .padding(.bottom, 6)
            VStack(spacing: 2) {
                row("Favourites", icon: "heart", active: nav.tab == .recipes && nav.favouritesOnly) {
                    nav.showRecipes(favourites: true)
                }
            }
            .padding(.horizontal, 10)

            Spacer()

            Rectangle().fill(Theme.border).frame(height: 1)
            SyncLine().padding(.horizontal, 18).padding(.vertical, 10)
            Rectangle().fill(Theme.border).frame(height: 1)
            VStack(spacing: 2) {
                item("Settings", icon: "gearshape", tab: .more)
            }
            .padding(10)
            if let me = app.me {
                Rectangle().fill(Theme.border).frame(height: 1)
                HStack(spacing: 10) {
                    Avatar(name: me.user.displayName, size: 34)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(me.user.displayName).font(.system(size: 14, weight: .semibold))
                        Text(me.household.role.capitalized).font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
                    }
                    Spacer()
                }
                .padding(14)
            }
        }
        .frame(width: 250)
        .background(Theme.background)
        .task {
            await shoppingCount.follow(app.store) { r in
                let lists = try r.records(.shoppingLists).compactMap(ShoppingList.init)
                guard let active = lists.first(where: { $0.status == "active" }) else { return 0 }
                return try r.records(.shoppingItems).compactMap(ShoppingItem.init)
                    .filter { $0.listId == active.id && !$0.isChecked }.count
            }
        }
    }

    private func item(_ title: String, icon: String, tab: AppNav.Tab, count: Int = 0) -> some View {
        row(title, icon: icon, count: count, active: nav.tab == tab && !(tab == .recipes && nav.favouritesOnly)) {
            if tab == .recipes { nav.favouritesOnly = false }
            nav.tab = tab
        }
    }

    /// Active: text-primary on bg-orange-50, rounded-lg — as the web's nav link.
    private func row(_ title: String, icon: String, count: Int = 0, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon).font(.system(size: 15)).frame(width: 20)
                Text(title).font(.system(size: 15, weight: active ? .medium : .regular))
                Spacer()
                if count > 0 {
                    Text("\(count)")
                        .font(.system(size: 12, weight: .semibold))
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(Theme.muted, in: Capsule())
                        .foregroundStyle(Theme.mutedForeground)
                }
            }
            .foregroundStyle(active ? Theme.brand : Theme.foreground.opacity(0.8))
            .padding(.horizontal, 12)
            .frame(height: 40)
            .background(active ? Theme.orange50 : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
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

// MARK: iPhone bottom bar (components/nav, mobile)

struct BottomBar: View {
    @Environment(AppModel.self) private var app
    @Environment(AppNav.self) private var nav
    @State private var tonight = Observed<CookRequest?>(nil)

    var body: some View {
        HStack(alignment: .bottom, spacing: 0) {
            item("Home", icon: "house", tab: .home)
            item("Recipes", icon: "book", tab: .recipes)
            // The raised middle button. On the web it opens the AI concierge;
            // here it starts cooking tonight's meal, or opens the planner when
            // nothing is planned.
            Button {
                if let request = tonight.value { nav.cooking = request } else { nav.tab = .plan }
            } label: {
                Image(systemName: "frying.pan.fill")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 58, height: 58)
                    .background(Theme.brand, in: Circle())
                    .shadow(color: Theme.brand.opacity(0.35), radius: 8, y: 4)
            }
            .buttonStyle(.plain)
            .offset(y: -14)
            .frame(maxWidth: .infinity)
            .accessibilityLabel(tonight.value == nil ? "Plan a meal" : "Cook tonight’s meal")
            item("Planner", icon: "calendar", tab: .plan)
            item("Shopping", icon: "cart", tab: .shopping)
        }
        .padding(.top, 6)
        .background(alignment: .top) {
            Theme.background
                .overlay(alignment: .top) { Rectangle().fill(Theme.border).frame(height: 1) }
                .ignoresSafeArea(edges: .bottom)
        }
        .task { await tonight.follow(app.store, TonightMeal.load) }
    }

    private func item(_ title: String, icon: String, tab: AppNav.Tab) -> some View {
        let active = nav.tab == tab || (tab == .home && nav.tab == .more)
        return Button {
            if tab == .recipes { nav.favouritesOnly = false }
            nav.tab = tab
        } label: {
            VStack(spacing: 3) {
                Image(systemName: icon).font(.system(size: 19))
                Text(title).font(.system(size: 11, weight: .medium))
            }
            .foregroundStyle(active ? Theme.brand : Theme.mutedForeground)
            .frame(maxWidth: .infinity, minHeight: 46)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
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
                .padding(.bottom, 96)
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
