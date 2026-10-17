// Home, as the web's /home: a time-of-day greeting, search, favourites, the
// "What we've been eating" banner and recently added recipes. Everything is
// read from the device, so it's all there with no signal.

import DishesCore
import SwiftUI

struct HomeScreen: View {
    @Environment(AppModel.self) private var app
    @Environment(AppNav.self) private var nav
    @Environment(\.horizontalSizeClass) private var width
    @Environment(\.openURL) private var openURL
    @State private var recipes = Observed<[Recipe]>([])

    private var firstName: String {
        app.me?.user.displayName.split(separator: " ").first.map(String.init) ?? "there"
    }

    /// apps/web/app/(app)/home/page.tsx: before 12, before 18, after.
    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
    }

    /// Four: two rows of two on a phone, a row on iPad — as the web.
    private let rowCount = 4

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    header
                    searchRow

                    let favourites = recipes.value.filter(\.isFavourite)
                    if !favourites.isEmpty {
                        section("Favourites", icon: "heart.fill", recipes: Array(favourites.prefix(rowCount))) {
                            nav.showRecipes(favourites: true)
                        }
                    }

                    statsBanner

                    let recent = recipes.value.sorted { ($0.createdAt ?? "") > ($1.createdAt ?? "") }
                    if !recent.isEmpty {
                        section("Recently Added", icon: nil, recipes: Array(recent.prefix(rowCount))) {
                            nav.showRecipes()
                        }
                    }
                }
                .padding(.horizontal, width == .regular ? 28 : 16)
                .padding(.vertical, 20)
                .frame(maxWidth: 1200)
                .frame(maxWidth: .infinity)
            }
            .background(Theme.background)
            .refreshable { await app.syncNow() }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: String.self) { RecipeDetailView(recipeId: $0) }
        }
        .task {
            await recipes.follow(app.store) { r in try r.records(.recipes).compactMap(Recipe.init) }
        }
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text("\(greeting), \(firstName)")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(Theme.foreground)
                Text("What shall we cook today?")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.mutedForeground)
            }
            Spacer()
            // On iPhone the avatar is the way into settings, as on the web.
            if width != .regular, let me = app.me {
                Button { nav.tab = .more } label: { Avatar(name: me.user.displayName, size: 42) }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Settings")
            }
        }
    }

    /// Looks like the web's search box; tapping it opens Recipes ready to search.
    private var searchRow: some View {
        Button { nav.showRecipes() } label: {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                Text("Search recipes, ingredients…")
                Spacer()
            }
            .font(.system(size: 15))
            .foregroundStyle(Theme.mutedForeground)
            .padding(.horizontal, 14)
            .frame(height: 44)
            .background(Theme.muted, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func section(_ title: String, icon: String?, recipes: [Recipe], seeAll: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: title, icon: icon, action: seeAll)
            RecipeGrid(recipes: recipes) { recipe in
                NavigationLink(value: recipe.id) { RecipeCard(recipe: recipe) }
                    .buttonStyle(.plain)
            }
        }
    }

    /// bg-gradient-to-r from-orange-500 to-rose-500, linking to the web's stats.
    private var statsBanner: some View {
        Button {
            openURL(AppModel.serverURL.appendingPathComponent("stats"))
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("What we’ve been eating").font(.system(size: 15, weight: .semibold))
                    Text("Stats, heart health, who ate what and your Wrapped")
                        .font(.system(size: 12))
                        .opacity(0.85)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 8)
                Text("See stats →")
                    .font(.system(size: 13, weight: .semibold))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(.white.opacity(0.2), in: Capsule())
            }
            .foregroundStyle(.white)
            .padding(16)
            .background(Theme.Gradient.orangeRose.linear, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .shadow(color: .black.opacity(0.1), radius: 4, y: 2)
        }
        .buttonStyle(.plain)
    }
}
