// The recipe library, as the web's /recipes: a header with the count, filter
// chips, the search box and a grid of web recipe cards — all from the local
// store. The full filter set (difficulty, time, tags, sorts) is
// lib/recipe-filtering.ts, to be ported with shared fixtures (C2).

import DishesCore
import SwiftUI

struct RecipesScreen: View {
    @Environment(AppModel.self) private var app
    @Environment(AppNav.self) private var nav
    @Environment(\.horizontalSizeClass) private var width
    @State private var recipes = Observed<[Recipe]>([])
    @State private var cuisine: String?
    @State private var collectionId: String?
    @State private var creating = false
    @State private var askingAI = false
    @State private var path = NavigationPath()

    private var shown: [Recipe] {
        let words = nav.recipeSearch.lowercased().split(separator: " ").map(String.init)
        return recipes.value.filter { recipe in
            if nav.favouritesOnly && !recipe.isFavourite { return false }
            if let cuisine, recipe.cuisine != cuisine { return false }
            if let collectionId, app.collections.first(where: { $0.id == collectionId })?.recipeIds.contains(recipe.id) != true {
                return false
            }
            guard !words.isEmpty else { return true }
            let haystack = ([recipe.title, recipe.cuisine ?? ""] + recipe.tags + recipe.ingredients.map(\.name))
                .joined(separator: " ").lowercased()
            return words.allSatisfy(haystack.contains)
        }
    }

    /// Cuisines by how many recipes use them, as the web suggests the most used first.
    private var cuisines: [(name: String, count: Int)] {
        Dictionary(grouping: recipes.value.compactMap(\.cuisine), by: { $0 })
            .map { ($0.key, $0.value.count) }
            .sorted { ($0.count, $1.name) > ($1.count, $0.name) }
    }

    var body: some View {
        @Bindable var nav = nav
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    PageHeader(title: nav.favouritesOnly ? "Favourites"
                                   : app.collections.first(where: { $0.id == collectionId })?.name ?? "Recipes",
                               subtitle: shown.count == recipes.value.count
                                   ? "\(recipes.value.count) recipes in your collection"
                                   : "\(shown.count) of \(recipes.value.count) recipes") {
                        HStack(spacing: 8) {
                            Button { askingAI = true } label: {
                                Label(width == .regular ? "Create with AI" : "AI", systemImage: "sparkles")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 14)
                                    .frame(height: 38)
                                    .background(Theme.Gradient.violetOrange.linear, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                            }
                            .buttonStyle(.plain)
                            Button { creating = true } label: {
                                Label("New Recipe", systemImage: "plus")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 14)
                                    .frame(height: 38)
                                    .background(Theme.brand, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    chips
                    SearchField(prompt: "Search recipes or ingredients…", text: $nav.recipeSearch)
                        .frame(maxWidth: width == .regular ? 520 : .infinity)
                    if recipes.loaded && shown.isEmpty {
                        EmptyBox(emoji: "🔎", message: nav.recipeSearch.isEmpty ? "No recipes here yet" : "No recipes match “\(nav.recipeSearch)”")
                    }
                    RecipeGrid(recipes: shown) { recipe in
                        NavigationLink(value: recipe.id) { RecipeCard(recipe: recipe) }
                            .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, width == .regular ? 32 : 16)
                .padding(.vertical, 20)
            }
            .scrollDismissesKeyboard(.immediately)
            .background(Theme.background)
            .refreshable { await app.syncNow() }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: String.self) { RecipeDetailView(recipeId: $0) }
            .sheet(isPresented: $askingAI) {
                ConciergeSheet { id in path.append(id) }
                    .presentationSizing(.page)
            }
            .sheet(isPresented: $creating) {
                // Opens the new recipe once it's synced down.
                RecipeEditor(recipeId: nil) { id in path.append(id) }
            }
        }
        .task {
            await recipes.follow(app.store) { r in
                try r.records(.recipes).compactMap(Recipe.init)
                    .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
            }
        }
    }

    /// The web's chip row: outline pills with a count; the selected one in primary.
    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip("Favourites", icon: "heart", count: recipes.value.filter(\.isFavourite).count,
                     selected: nav.favouritesOnly) { nav.favouritesOnly.toggle() }
                // The web's collection chips: icon, name, count.
                ForEach(app.collections) { collection in
                    chip("\(collection.icon.map { "\($0) " } ?? "")\(collection.name)", icon: nil,
                         count: collection.recipeIds.count, selected: collectionId == collection.id) {
                        collectionId = collectionId == collection.id ? nil : collection.id
                    }
                }
                if !app.collections.isEmpty {
                    Rectangle().fill(Theme.border).frame(width: 1, height: 20)
                }
                ForEach(cuisines.prefix(8), id: \.name) { item in
                    chip(item.name, icon: nil, count: item.count, selected: cuisine == item.name) {
                        cuisine = cuisine == item.name ? nil : item.name
                    }
                }
            }
            .padding(.vertical, 2)
        }
    }

    private func chip(_ title: String, icon: String?, count: Int, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let icon { Image(systemName: selected ? "\(icon).fill" : icon).imageScale(.small) }
                Text(title).font(.system(size: 13, weight: .medium))
                Text("\(count)").font(.system(size: 12)).foregroundStyle(selected ? .white.opacity(0.8) : Theme.mutedForeground)
            }
            .foregroundStyle(selected ? .white : Theme.foreground)
            .padding(.horizontal, 12)
            .frame(height: 32)
            .background(selected ? Theme.brand : Theme.background, in: Capsule())
            .overlay(Capsule().strokeBorder(selected ? .clear : Theme.border))
        }
        .buttonStyle(.plain)
    }
}
