// The recipe library, as the web's /recipes: a header with the count, filter
// chips, the search box and a grid of web recipe cards — all from the local
// store. Filters (dish role, difficulty, time, tags, heart-healthy) and sorts
// follow the web's lib/recipe-filtering.ts.

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
    @State private var importingCrumb = false
    @State private var path = NavigationPath()
    @State private var filters = RecipeFilters()
    @State private var filtering = false
    /// Average rating (0–10) per recipe, from the synced cook history, for the rating sort.
    @State private var ratings = Observed<[String: Double]>([:])

    private var shown: [Recipe] {
        let words = nav.recipeSearch.lowercased().split(separator: " ").map(String.init)
        return recipes.value.filter { recipe in
            if nav.favouritesOnly && !recipe.isFavourite { return false }
            if let cuisine, recipe.cuisine != cuisine { return false }
            if let collectionId, app.collections.first(where: { $0.id == collectionId })?.recipeIds.contains(recipe.id) != true {
                return false
            }
            if !filters.matches(recipe) { return false }
            guard !words.isEmpty else { return true }
            let haystack = ([recipe.title, recipe.cuisine ?? ""] + recipe.tags + recipe.ingredients.map(\.name))
                .joined(separator: " ").lowercased()
            return words.allSatisfy(haystack.contains)
        }
        .sorted(by: filters.order(ratings.value))
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
                            Menu {
                                Button("Import from Crumb…", systemImage: "tray.and.arrow.down") { importingCrumb = true }
                            } label: {
                                Image(systemName: "square.and.arrow.down")
                                    .font(.system(size: 15, weight: .semibold))
                                    .frame(width: 38, height: 38)
                                    .background(Theme.muted, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                            }
                            .foregroundStyle(Theme.foreground)
                            .accessibilityLabel("Import")
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
                    HStack(spacing: 10) {
                        SearchField(prompt: "Search recipes or ingredients…", text: $nav.recipeSearch)
                            .frame(maxWidth: width == .regular ? 520 : .infinity)
                        Button { filtering = true } label: {
                            Label(filters.activeCount == 0 ? "Filters" : "Filters · \(filters.activeCount)", systemImage: "line.3.horizontal.decrease")
                                .font(.system(size: 14, weight: .semibold))
                                .padding(.horizontal, 12).frame(height: 40)
                                .foregroundStyle(filters.activeCount == 0 ? Theme.foreground : .white)
                                .background(filters.activeCount == 0 ? Theme.muted : Theme.brand, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
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
            .sheet(isPresented: $importingCrumb) { CrumbImportSheet() }
            .sheet(isPresented: $askingAI) {
                ConciergeSheet { id in path.append(id) }
                    .presentationSizing(.page)
            }
            .sheet(isPresented: $creating) {
                // Opens the new recipe once it's synced down.
                RecipeEditor(recipeId: nil) { id in path.append(id) }
            }
        }
        .sheet(isPresented: $filtering) {
            RecipeFilterSheet(filters: $filters, tags: Array(Set(recipes.value.flatMap(\.tags))).sorted())
        }
        .task {
            await ratings.follow(app.store) { r in
                var sums: [String: (Double, Int)] = [:]
                for entry in try r.records(.cookHistory).compactMap(CookEntry.init) {
                    guard let rating = entry.rating else { continue }
                    let s = sums[entry.recipeId] ?? (0, 0)
                    sums[entry.recipeId] = (s.0 + rating, s.1 + 1)
                }
                return sums.mapValues { $0.0 / Double($0.1) }
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

/// The web's recipe filters (lib/recipe-filtering.ts) and sorts.
struct RecipeFilters: Equatable {
    enum Sort: String, CaseIterable { case newest, az, rating }
    var role: String?
    var difficulty: Difficulty?
    var maxMinutes: Int?
    var tags: Set<String> = []
    var heartHealthy = false
    var sort = Sort.az

    var activeCount: Int {
        [role != nil, difficulty != nil, maxMinutes != nil, !tags.isEmpty, heartHealthy].filter { $0 }.count
    }

    func matches(_ r: Recipe) -> Bool {
        if let role, r.mealRole != role { return false }
        if let difficulty, r.difficulty != difficulty { return false }
        if let maxMinutes {
            // As the web: a recipe with no times at all is left out, not counted as 0.
            guard r.prepTimeMinutes != nil || r.cookTimeMinutes != nil else { return false }
            if (r.prepTimeMinutes ?? 0) + (r.cookTimeMinutes ?? 0) > maxMinutes { return false }
        }
        if !tags.isEmpty {
            let lower = Set(tags.map { $0.lowercased() })
            if !r.tags.contains(where: { lower.contains($0.lowercased()) }) { return false }
        }
        if heartHealthy && !r.isHeartHealthy { return false }
        return true
    }

    func order(_ ratings: [String: Double]) -> (Recipe, Recipe) -> Bool {
        switch sort {
        case .az: { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
        case .newest: { ($0.createdAt ?? "") > ($1.createdAt ?? "") }
        case .rating: { (ratings[$0.id] ?? -1) > (ratings[$1.id] ?? -1) }
        }
    }
}

private struct RecipeFilterSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var filters: RecipeFilters
    let tags: [String]

    var body: some View {
        NavigationStack {
            Form {
                Picker("Sort by", selection: $filters.sort) {
                    Text("A–Z").tag(RecipeFilters.Sort.az)
                    Text("Newest").tag(RecipeFilters.Sort.newest)
                    Text("Highest rated").tag(RecipeFilters.Sort.rating)
                }
                Section("Show") {
                    Picker("Dish", selection: $filters.role) {
                        Text("Any").tag(String?.none)
                        Text("Mains").tag(String?.some("main")); Text("Sides").tag(String?.some("side"))
                        Text("Sauces").tag(String?.some("sauce")); Text("Other").tag(String?.some("other"))
                    }
                    Picker("Difficulty", selection: $filters.difficulty) {
                        Text("Any").tag(Difficulty?.none)
                        ForEach(Difficulty.allCases, id: \.self) { Text($0.rawValue.capitalized).tag(Difficulty?.some($0)) }
                    }
                    Picker("Ready in", selection: $filters.maxMinutes) {
                        Text("Any time").tag(Int?.none)
                        ForEach([15, 30, 45, 60, 90], id: \.self) { Text("\($0) min or less").tag(Int?.some($0)) }
                    }
                    Toggle("Heart-healthy only", isOn: $filters.heartHealthy).tint(Theme.brand)
                }
                if !tags.isEmpty {
                    Section("Tags (any of)") {
                        FlowLayout(spacing: 8) {
                            ForEach(tags, id: \.self) { tag in
                                let on = filters.tags.contains(tag)
                                Button(tag) { if on { filters.tags.remove(tag) } else { filters.tags.insert(tag) } }
                                    .font(.system(size: 14, weight: .medium))
                                    .padding(.horizontal, 12).frame(height: 32)
                                    .foregroundStyle(on ? .white : Theme.foreground)
                                    .background(on ? Theme.brand : Theme.muted, in: Capsule())
                                    .buttonStyle(.plain)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
                if filters.activeCount > 0 {
                    Button("Clear filters", role: .destructive) { filters = RecipeFilters(sort: filters.sort) }
                }
            }
            .navigationTitle("Filter recipes").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.bold() } }
        }
        .presentationDetents([.medium, .large])
    }
}
