// The recipe library, from the local store: search on title, cuisine and tags,
// a favourites filter, and a grid of cards that becomes a list at iPhone
// width. The full filter set (difficulty, time, tags, sorts) is
// lib/recipe-filtering.ts, to be ported with shared fixtures (C2).

import DishesCore
import SwiftUI

struct RecipesScreen: View {
    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var width
    @State private var recipes = Observed<[Recipe]>([])
    @State private var search = ""
    @State private var favouritesOnly = false

    private var shown: [Recipe] {
        let words = search.lowercased().split(separator: " ").map(String.init)
        return recipes.value.filter { recipe in
            if favouritesOnly && !recipe.isFavourite { return false }
            guard !words.isEmpty else { return true }
            let haystack = ([recipe.title, recipe.cuisine ?? ""] + recipe.tags).joined(separator: " ").lowercased()
            return words.allSatisfy(haystack.contains)
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                if width == .regular {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 220, maximum: 320), spacing: 18)], spacing: 18) {
                        ForEach(shown) { recipe in
                            NavigationLink(value: recipe.id) { RecipeCard(recipe: recipe) }
                                .buttonStyle(.plain)
                        }
                    }
                    .padding(20)
                } else {
                    LazyVStack(spacing: 12) {
                        ForEach(shown) { recipe in
                            NavigationLink(value: recipe.id) { RecipeRow(recipe: recipe) }
                                .buttonStyle(.plain)
                        }
                    }
                    .padding(16)
                }
            }
            .background(Theme.background.ignoresSafeArea())
            .overlay {
                if recipes.loaded && shown.isEmpty {
                    ContentUnavailableView.search(text: search)
                }
            }
            .navigationTitle("Recipes")
            .searchable(text: $search, prompt: "Title, cuisine or tag")
            .toolbar {
                Toggle(isOn: $favouritesOnly) { Label("Favourites", systemImage: favouritesOnly ? "heart.fill" : "heart") }
                    .toggleStyle(.button)
            }
            .refreshable { await app.syncNow() }
            .navigationDestination(for: String.self) { RecipeDetailView(recipeId: $0) }
        }
        .task {
            await recipes.follow(app.store) { r in
                try r.records(.recipes).compactMap(Recipe.init)
                    .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
            }
        }
    }
}

struct RecipeCard: View {
    let recipe: Recipe

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            RecipeImage(recipe: recipe)
                .frame(height: 150)
                .frame(maxWidth: .infinity)
                .clipped()
                .overlay(alignment: .topTrailing) {
                    if recipe.isFavourite {
                        Image(systemName: "heart.fill")
                            .foregroundStyle(.white)
                            .padding(8)
                            .background(.red.opacity(0.85), in: Circle())
                            .padding(10)
                    }
                }
            VStack(alignment: .leading, spacing: 6) {
                Text(recipe.title)
                    .font(.headline)
                    .lineLimit(2, reservesSpace: true)
                RecipeMeta(recipe: recipe)
            }
            .padding(14)
        }
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .card(tint: Theme.tint(for: recipe.cuisine ?? recipe.title))
    }
}

struct RecipeRow: View {
    let recipe: Recipe

    var body: some View {
        HStack(spacing: 14) {
            RecipeImage(recipe: recipe)
                .frame(width: 72, height: 72)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline) {
                    Text(recipe.title).font(.headline).lineLimit(2)
                    if recipe.isFavourite { Image(systemName: "heart.fill").font(.caption).foregroundStyle(.red) }
                }
                RecipeMeta(recipe: recipe)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .padding(12)
        .card(tint: Theme.tint(for: recipe.cuisine ?? recipe.title))
    }
}

/// Cuisine · time · difficulty, in one quiet line.
struct RecipeMeta: View {
    let recipe: Recipe

    var body: some View {
        let parts = [recipe.cuisine, Format.minutes(recipe.totalMinutes), recipe.difficulty?.rawValue.capitalized]
            .compactMap { $0 }
        Text(parts.joined(separator: " · "))
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .lineLimit(1)
    }
}
