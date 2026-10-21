// The recipe library, as the web's /recipes: a header with the count, filter
// chips, the search box and a grid of web recipe cards — all from the local
// store. Filters (dish role, difficulty, time, tags, heart-healthy) and sorts
// follow the web's lib/recipe-filtering.ts.
//
// It's also the app's front door. With nothing searched or filtered it shows
// browse mode (RecipesBrowse: tonight's meal and shelves of recipes) rather
// than the grid; the All chip, a search or any filter switches to the grid,
// and Clear goes back.

import DishesCore
import PhotosUI
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
    @State private var usingCamera = false
    @State private var choosingPhoto = false
    /// New Recipe → From a website: a page to import (nil link: ask for one).
    @State private var webImport: WebImportLink?
    @State private var pickedPhoto: PhotosPickerItem?
    /// A recipe photo to read in with the AI.
    @State private var photo: RecipePhoto?
    @State private var path = NavigationPath()
    @State private var filters = RecipeFilters()
    @State private var filtering = false
    /// Average rating (0–10) and last cook per recipe, from the synced cook history.
    @State private var cookStats = Observed(CookStats())
    @State private var tonight = Observed<TonightCard.Meal?>(nil)
    @State private var taste = Remote<TasteData>("taste.get")
    /// The whole library as a grid, with nothing filtered (the All chip).
    @State private var showAll = false
    @State private var scroll = ScrollPosition(edge: .top)

    struct CookStats: Sendable {
        var ratings: [String: Double] = [:]
        var lastCooked: [String: Date] = [:]
    }

    /// Browse mode: nothing searched, chosen or filtered.
    private var browsing: Bool {
        !showAll && nav.recipeSearch.isEmpty && !nav.favouritesOnly && cuisine == nil
            && collectionId == nil && filters == RecipeFilters()
    }

    private func clear() {
        showAll = false
        nav.recipeSearch = ""
        nav.favouritesOnly = false
        cuisine = nil
        collectionId = nil
        filters = RecipeFilters()
    }

    private var title: String {
        if nav.favouritesOnly { return "Favourites" }
        if let name = app.collections.first(where: { $0.id == collectionId })?.name { return name }
        if let cuisine { return cuisine }
        if nav.recipeSearch.isEmpty && filters.activeCount == 0 {
            switch filters.sort {
            case .cooked: return "Cook again"
            case .newest: return "Recently added"
            default: if showAll { return "All recipes" }
            }
        }
        return "Recipes"
    }

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
        .sorted(by: filters.order(cookStats.value))
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
                    PageHeader(title: browsing ? "Recipes" : title,
                               subtitle: browsing || shown.count == recipes.value.count
                                   ? "\(recipes.value.count) recipes in your collection"
                                   : "\(shown.count) of \(recipes.value.count) recipes") {
                        Group {
                            if width == .regular {
                                // iPad: room for the labelled buttons.
                                HStack(spacing: 8) {
                                    Button { openBook() } label: {
                                        headerLabel("Cookbook", "book.closed")
                                            .background(Color(hex: 0x8B5A2B), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel("Open as a cookbook")
                                    Button { askingAI = true } label: {
                                        headerLabel("Create with AI", "sparkles")
                                            .background(Theme.Gradient.violetOrange.linear, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel("Create with AI")
                                    Menu { newRecipeItems } label: {
                                        headerLabel("New Recipe", "plus")
                                            .background(Theme.brand, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                                    }
                                    .accessibilityLabel("New Recipe")
                                }
                            } else {
                                // iPhone: one round + (as the planner's), everything else in its menu.
                                Menu {
                                    newRecipeItems
                                    Button("Create with AI", systemImage: "sparkles") { askingAI = true }
                                    Divider()
                                    Button("Open the cookbook", systemImage: "book.closed") { openBook() }
                                } label: {
                                    Image(systemName: "plus")
                                        .font(.system(size: 17, weight: .semibold))
                                        .foregroundStyle(.white)
                                        .frame(width: 38, height: 38)
                                        .background(Theme.brand, in: Circle())
                                        .shadow(color: .black.opacity(0.15), radius: 4, y: 2)
                                }
                                .accessibilityLabel("Add a recipe, or open the cookbook")
                            }
                        }
                        .fixedSize()
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
                    if recipes.loaded && recipes.value.isEmpty {
                        EmptyBox(emoji: "🍳", message: "No recipes here yet")
                    } else if browsing {
                        RecipesBrowse(recipes: recipes.value, lastCooked: cookStats.value.lastCooked,
                                      suggested: taste.value?.suggested ?? [], tonight: tonight.value,
                                      cuisines: cuisines) { shelf in
                            switch shelf {
                            case .favourites: nav.favouritesOnly = true
                            case .cookAgain: filters.sort = .cooked
                            case .recent: filters.sort = .newest
                            case .cuisine(let name): cuisine = name
                            }
                        }
                        .padding(.top, 6)
                    } else {
                        if recipes.loaded && shown.isEmpty {
                            EmptyBox(emoji: "🔎", message: nav.recipeSearch.isEmpty ? "No recipes match these filters" : "No recipes match “\(nav.recipeSearch)”")
                        }
                        RecipeGrid(recipes: shown) { recipe in
                            NavigationLink(value: recipe.id) { RecipeCard(recipe: recipe) }
                                .buttonStyle(.plain)
                        }
                    }
                }
                .padding(.horizontal, width == .regular ? 32 : 16)
                .padding(.vertical, 20)
            }
            .scrollPosition($scroll)
            // A shelf's See all is often far down the page: start the grid at its top, and the shelves again after Clear.
            .onChange(of: browsing) { scroll.scrollTo(edge: .top) }
            .scrollDismissesKeyboard(.immediately)
            .background(Theme.background)
            .refreshable {
                await app.syncNow()
                await taste.load()
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: String.self) { RecipeDetailView(recipeId: $0) }
            // A recipe the AI tab just wrote, opened here.
            .onChange(of: nav.openedRecipe, initial: true) { _, id in
                guard let id else { return }
                nav.openedRecipe = nil
                path.append(id)
            }
            // A cuisine or difficulty badge tapped on a recipe page: back to the
            // grid, showing the recipes that share it.
            .onChange(of: nav.recipeTag, initial: true) { _, tag in
                guard let tag else { return }
                nav.recipeTag = nil
                clear()
                switch tag {
                case .cuisine(let name): cuisine = name
                case .difficulty(let level): filters.difficulty = level
                }
                path = NavigationPath()
            }
            .sheet(item: $photo) { photo in
                ConciergeSheet(photos: photo.pages) { id in path.append(id) }
                    .presentationSizing(.page)
            }
            .fullScreenCover(isPresented: $usingCamera) {
                if DocumentScanner.isAvailable {
                    DocumentScanner { photo = RecipePhoto(pages: $0) }.ignoresSafeArea()
                } else {
                    CameraPicker { photo = RecipePhoto(pages: [$0]) }.ignoresSafeArea()
                }
            }
            .photosPicker(isPresented: $choosingPhoto, selection: $pickedPhoto, matching: .images)
            .onChange(of: pickedPhoto) { _, item in
                guard let item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
                        photo = RecipePhoto(pages: [image])
                    }
                    pickedPhoto = nil
                }
            }
            .sheet(item: $webImport) { page in
                WebImportSheet(link: page.url.isEmpty ? nil : page.url) { id in path.append(id) }
                    .presentationSizing(.page)
            }
            // A page sent from a Shortcut (dishes://import?url=…).
            .onChange(of: nav.importLink, initial: true) { _, link in
                guard let link else { return }
                nav.importLink = nil
                webImport = link
            }
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
            RecipeFilterSheet(filters: $filters,
                              tagCounts: Dictionary(recipes.value.flatMap(\.tags).map { ($0, 1) }, uniquingKeysWith: +))
        }
        .task {
            await cookStats.follow(app.store) { r in
                var sums: [String: (Double, Int)] = [:]
                var last: [String: Date] = [:]
                for entry in try r.records(.cookHistory).compactMap(CookEntry.init) {
                    if entry.isCook, entry.cookedAt > last[entry.recipeId] ?? .distantPast {
                        last[entry.recipeId] = entry.cookedAt
                    }
                    guard let rating = entry.rating else { continue }
                    let s = sums[entry.recipeId] ?? (0, 0)
                    sums[entry.recipeId] = (s.0 + rating, s.1 + 1)
                }
                return CookStats(ratings: sums.mapValues { $0.0 / Double($0.1) }, lastCooked: last)
            }
        }
        .task { await tonight.follow(app.store, TonightCard.load) }
        .task { await taste.load() }
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
                if !browsing && !(showAll && filtersOff) {
                    Button(action: clear) {
                        Label("Clear", systemImage: "xmark")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.brandDeep)
                            .padding(.horizontal, 12)
                            .frame(height: 32)
                            .background(Theme.orange50, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
                chip("All", icon: "square.grid.2x2", count: recipes.value.count, selected: showAll) {
                    if showAll { clear() } else { showAll = true }
                }
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

    /// Nothing narrows the grid but (perhaps) the All chip.
    private var filtersOff: Bool {
        nav.recipeSearch.isEmpty && !nav.favouritesOnly && cuisine == nil && collectionId == nil
            && filters == RecipeFilters()
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
    enum Sort: String, CaseIterable { case newest, az, rating, cooked }
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

    func order(_ stats: RecipesScreen.CookStats) -> (Recipe, Recipe) -> Bool {
        switch sort {
        case .az: { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
        case .newest: { ($0.createdAt ?? "") > ($1.createdAt ?? "") }
        case .rating: { (stats.ratings[$0.id] ?? -1) > (stats.ratings[$1.id] ?? -1) }
        // Never-cooked recipes last, as the web's "cooked" sort.
        case .cooked: { (stats.lastCooked[$0.id] ?? .distantPast) > (stats.lastCooked[$1.id] ?? .distantPast) }
        }
    }
}

/// A photo picked from New Recipe, or a scan's pages, for the AI to read in.
private struct RecipePhoto: Identifiable {
    let id = UUID()
    let pages: [UIImage]
}

extension RecipesScreen {
    /// The ways to add a recipe — the New Recipe menu on iPad, the top of the + menu on iPhone.
    @ViewBuilder var newRecipeItems: some View {
        Button("Write a recipe", systemImage: "square.and.pencil") { creating = true }
        if UIImagePickerController.isSourceTypeAvailable(.camera) {
            // The document camera flattens the page and takes several (a two-page recipe).
            Button(DocumentScanner.isAvailable ? "Scan a recipe…" : "Photograph a recipe",
                   systemImage: DocumentScanner.isAvailable ? "doc.viewfinder" : "camera") { usingCamera = true }
        }
        Button("From a photo…", systemImage: "photo") { choosingPhoto = true }
        Button("From a website…", systemImage: "globe") { webImport = WebImportLink(page: "") }
    }

    /// The recipes on screen as a cookbook (every recipe while browsing).
    func openBook() { nav.book = BookRequest(recipeIds: browsing ? nil : shown.map(\.id)) }

    /// A header button's label: words and icon on iPad, the icon alone on iPhone.
    @ViewBuilder func headerLabel(_ title: String, _ icon: String) -> some View {
        Group {
            if width == .regular {
                Label(title, systemImage: icon).padding(.horizontal, 14)
            } else {
                Image(systemName: icon).frame(width: 38)
            }
        }
        .font(.system(size: 14, weight: .semibold))
        .foregroundStyle(.white)
        .frame(height: 38)
    }
}

private struct RecipeFilterSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var filters: RecipeFilters
    /// Every tag in the library and how many recipes have it.
    let tagCounts: [String: Int]
    @State private var tagSearch = ""
    @State private var allTags = false

    private static let topTags = 12

    /// What the tag section shows: picked tags first, then matches for the
    /// search, or the most-used tags (all of them after "Show all").
    private var shownTags: [String] {
        let byUse = tagCounts.keys.sorted { (tagCounts[$0] ?? 0, $1) > (tagCounts[$1] ?? 0, $0) }
        let picked = byUse.filter { filters.tags.contains($0) }
        let rest = byUse.filter { !filters.tags.contains($0) }
        let query = tagSearch.trimmingCharacters(in: .whitespaces)
        if !query.isEmpty { return picked + rest.filter { $0.localizedCaseInsensitiveContains(query) } }
        return picked + (allTags ? rest : Array(rest.prefix(Self.topTags)))
    }

    var body: some View {
        NavigationStack {
            Form {
                Picker("Sort by", selection: $filters.sort) {
                    Text("A–Z").tag(RecipeFilters.Sort.az)
                    Text("Newest").tag(RecipeFilters.Sort.newest)
                    Text("Highest rated").tag(RecipeFilters.Sort.rating)
                    Text("Recently cooked").tag(RecipeFilters.Sort.cooked)
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
                if !tagCounts.isEmpty {
                    Section {
                        if tagCounts.count > Self.topTags {
                            TextField("Find a tag", text: $tagSearch)
                                .textInputAutocapitalization(.never).autocorrectionDisabled()
                        }
                        let shown = shownTags
                        if shown.isEmpty {
                            Text("No tags match “\(tagSearch)”.").foregroundStyle(.secondary)
                        } else {
                            FlowLayout(spacing: 8) {
                                ForEach(shown, id: \.self) { tag in
                                    let on = filters.tags.contains(tag)
                                    Button { if on { filters.tags.remove(tag) } else { filters.tags.insert(tag) } } label: {
                                        HStack(spacing: 5) {
                                            Text(tag)
                                            Text("\(tagCounts[tag] ?? 0)").foregroundStyle(on ? .white.opacity(0.8) : Theme.mutedForeground)
                                        }
                                    }
                                    .font(.system(size: 14, weight: .medium))
                                    .padding(.horizontal, 12).frame(height: 32)
                                    .foregroundStyle(on ? .white : Theme.foreground)
                                    .background(on ? Theme.brand : Theme.muted, in: Capsule())
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                        if tagSearch.isEmpty && tagCounts.count > Self.topTags {
                            Button(allTags ? "Show the most used" : "Show all \(tagCounts.count) tags") {
                                withAnimation { allTags.toggle() }
                            }
                        }
                    } header: { Text("Tags (any of)") } footer: {
                        if tagSearch.isEmpty && !allTags && tagCounts.count > Self.topTags {
                            Text("The \(Self.topTags) most used — search to find the rest.")
                        }
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
