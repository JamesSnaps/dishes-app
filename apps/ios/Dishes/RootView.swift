// Sign-in, or the four tabs. On iPad in regular width the tab bar becomes a
// sidebar (`.sidebarAdaptable`); in Split View or Slide Over it goes back to
// tabs, so every screen is also checked at iPhone width.
//
//   RootView()   // DishesApp's only scene content

import DishesCore
import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var app
    @AppStorage("tab") private var tab = Tab.plan

    enum Tab: String { case plan, recipes, shopping, more }

    var body: some View {
        Group {
            switch app.phase {
            case .starting:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case .signedOut:
                SignInView()
            case .ready:
                tabs
            }
        }
        .overlay(alignment: .bottom) { ToastView() }
        // A finished timer rings wherever you are in the app, not only in cooking mode.
        .overlay(alignment: .top) { RingingBanner() }
        .task { await app.start() }
    }

    private var tabs: some View {
        TabView(selection: $tab) {
            SwiftUI.Tab("Plan", systemImage: "calendar", value: Tab.plan) { PlanScreen() }
            SwiftUI.Tab("Recipes", systemImage: "book.closed", value: Tab.recipes) { RecipesScreen() }
            SwiftUI.Tab("Shopping", systemImage: "cart", value: Tab.shopping) { ShoppingScreen() }
            SwiftUI.Tab("More", systemImage: "ellipsis.circle", value: Tab.more) { MoreScreen() }
        }
        .tabViewStyle(.sidebarAdaptable)
    }
}

/// The app's one-line messages, dismissed after a few seconds.
struct ToastView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        if let message = app.toast {
            Text(message)
                .font(.subheadline.weight(.medium))
                .padding(.horizontal, 18)
                .padding(.vertical, 12)
                .background(.thickMaterial, in: Capsule())
                .shadow(radius: 8, y: 4)
                .padding(.bottom, 90)
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
