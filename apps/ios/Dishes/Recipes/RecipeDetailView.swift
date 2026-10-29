// One recipe, laid out as the web's /recipes/[id] (DESIGN.md → Recipe detail):
// an overline of cuisine and difficulty, the serif title and heart, the dish
// type, time and servings in a hairline-divided row, the servings stepper,
// Start Cooking, nutrition when there is some, then Overview / Ingredients /
// Steps tabs with the terracotta underline. When the page is wide enough (iPad landscape, or
// portrait without the sidebar) the ingredients sit beside the method instead
// of behind a tab — decided by the space, not the device.
//
// Below the header: the household's rating and how often it's been cooked and
// planned; the full nutrition panel; Add to shopping list on
// the ingredients; and, after the method, every logged cook and a few
// recipes like this one — all from the device's copy.
//
// Scaling multiplies amounts and shows kitchen fractions; unit promotion
// (1000 g → 1 kg) comes with the lib/scale-ingredient.ts port (C2).

import AppIntents
import DishesCore
import SwiftUI

struct RecipeDetailView: View {
    @Environment(AppModel.self) private var app
    @Environment(AppNav.self) private var nav
    @Environment(\.horizontalSizeClass) private var width
    let recipeId: String
    @State private var recipe = Observed<Recipe?>(nil)
    @State private var extras = Observed(RecipeExtras())
    /// On screen, so offered to the family's other devices (Handoff, DishesLink).
    @State private var showing = false
    @State private var logging = false
    @State private var editing = false
    @State private var tool: RecipeTool?
    /// A recipe the tools made (a copy, a similar dish), opened after.
    @State private var made: String?
    @State private var confirmDelete = false
    @State private var naming = false
    @State private var newCollection = ""
    @Environment(\.dismiss) private var dismissPage
    @State private var servings: Double?
    @State private var tab = Tab.ingredients
    @State private var pageWidth: CGFloat = 0
    @State private var choosingRole = false

    /// Room for a 330pt ingredients column and a readable method beside it.
    private var sideBySide: Bool { pageWidth >= 760 }
    /// Wide enough (iPad landscape) for the web's two columns: photo and
    /// details on the left, ingredients and method tabbed on the right.
    private var twoColumn: Bool { pageWidth >= 1000 }

    enum Tab { case overview, ingredients, steps }

    var body: some View {
        Group {
            if let recipe = recipe.value {
                content(recipe)
            } else if recipe.loaded {
                ContentUnavailableView("Recipe not found", systemImage: "book.closed",
                                       description: Text("It may have been deleted on another device."))
            } else {
                ProgressView()
            }
        }
        .background(Theme.background)
        // What's on screen, for Siri: "add this to Friday", "add this to the shopping list".
        .appEntityIdentifier(EntityIdentifier(for: RecipeEntity.self, identifier: recipeId))
        .handoff(.recipe(recipeId), title: recipe.value?.title ?? "Recipe", isActive: showing)
        .onAppear { showing = true }
        .onDisappear { showing = false }
        .navigationBarTitleDisplayMode(.inline)
        .task {
            let id = recipeId
            await recipe.follow(app.store) { r in try r.record(.recipes, id: id).flatMap(Recipe.init) }
        }
        .task {
            let id = recipeId
            await extras.follow(app.store) { r in try RecipeExtras.load(r, recipeId: id) }
        }
        .sheet(isPresented: $logging) {
            if let recipe = recipe.value { CookReviewSheet(recipe: recipe).presentationSizing(.page) }
        }
        .sheet(isPresented: $editing) { RecipeEditor(recipeId: recipeId) }
        .sheet(isPresented: $choosingRole) {
            if let recipe = recipe.value {
                RecipeRoleSheet(recipe: recipe) { tool = .sides }
                    .presentationDetents([.height(300)])
            }
        }
        .sheet(item: $tool) { tool in
            if let recipe = recipe.value {
                switch tool {
                case .improve: RecipeTweakSheet(recipe: recipe, kind: .improve) { made = $0 }.presentationSizing(.page)
                case .heartHealthy: RecipeTweakSheet(recipe: recipe, kind: .heartHealthy) { made = $0 }.presentationSizing(.page)
                case .similar: RecipeIdeasSheet(recipe: recipe, kind: .similar) { made = $0 }
                case .sides: RecipeIdeasSheet(recipe: recipe, kind: .sides) { made = $0 }
                case .share: ShareRecipeSheet(recipe: recipe)
                case .note: NoteSheet(edit: NoteEdit(note: nil, recipeId: recipe.id, recipeTitle: recipe.title)) {}
                case .photo: RecipePhotoSheet(recipe: recipe).presentationDetents([.medium, .large])
                default: EmptyView()
                }
            }
        }
        .navigationDestination(item: $made) { RecipeDetailView(recipeId: $0) }
        .toolbar {
            if let recipe = recipe.value {
                ToolbarItem(placement: .primaryAction) { actionsMenu(recipe) }
            }
        }
        .confirmationDialog("Delete this recipe?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { Task { await delete() } }
        } message: {
            Text("It’s removed for the whole household, with its cook history.")
        }
        .alert("New collection", isPresented: $naming) {
            TextField("Name", text: $newCollection)
            Button("Create") {
                let name = newCollection
                newCollection = ""
                Task { await app.createCollection(named: name, adding: recipe.value) }
            }
            Button("Cancel", role: .cancel) { newCollection = "" }
        }
    }

    private func scale(_ recipe: Recipe) -> Double {
        guard let base = recipe.servings, base > 0 else { return 1 }
        return (servings ?? base) / base
    }

    private func content(_ recipe: Recipe) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if twoColumn {
                    HStack(alignment: .top, spacing: 32) {
                        VStack(alignment: .leading, spacing: 18) {
                            summary(recipe)
                            overview(recipe)
                        }
                        .frame(width: (pageWidth - 56 - 32) * 0.42, alignment: .leading)
                        VStack(alignment: .leading, spacing: 14) {
                            let current = tab == .overview ? Tab.ingredients : tab
                            HStack(spacing: 0) {
                                tabButton("Ingredients (\(recipe.ingredients.count))", .ingredients, selected: current)
                                tabButton("Method (\(recipe.steps.count))", .steps, selected: current)
                            }
                            .overlay(alignment: .bottom) { Rectangle().fill(Theme.border).frame(height: 1) }
                            if current == .steps {
                                steps(recipe)
                            } else {
                                ingredientsHeader(recipe)
                                ingredients(recipe)
                            }
                        }
                    }
                } else {
                    summary(recipe)
                    if sideBySide {
                        overview(recipe)
                        HStack(alignment: .top, spacing: 28) {
                            VStack(alignment: .leading, spacing: 12) {
                                HStack {
                                    Text("Ingredients").font(.system(size: 19, weight: .bold))
                                    Spacer()
                                    addToListButton(recipe)
                                }
                                ingredients(recipe)
                            }
                            .frame(width: 330, alignment: .leading)
                            VStack(alignment: .leading, spacing: 12) {
                                Text("Method").font(.system(size: 19, weight: .bold))
                                steps(recipe)
                            }
                        }
                    } else {
                        tabs(recipe)
                        switch tab {
                        case .overview: overview(recipe)
                        case .ingredients:
                            ingredientsHeader(recipe)
                            ingredients(recipe)
                        case .steps: steps(recipe)
                        }
                    }
                }

                history(recipe)
                related
            }
            .padding(.horizontal, width == .regular ? 28 : 16)
            .padding(.vertical, 16)
            .frame(maxWidth: 1240)
            .frame(maxWidth: .infinity)
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { pageWidth = $0 }
    }

    /// Photo, title, badges, rating, servings and Start Cooking, then nutrition.
    @ViewBuilder
    private func summary(_ recipe: Recipe) -> some View {
        if recipe.imageUrl != nil {
            Color.clear
                .aspectRatio(twoColumn ? 1.4 : width == .regular ? 2.4 : 1.6, contentMode: .fit)
                .overlay { RecipeImage(recipe: recipe, thumbnail: false) }
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        header(recipe)
        ratingRow(recipe)
        controls(recipe)
        NutritionPanel(recipe: recipe)
    }

    private func ingredientsHeader(_ recipe: Recipe) -> some View {
        HStack {
            Text("\(recipe.ingredients.count) ingredients").font(.system(size: 14)).foregroundStyle(Theme.mutedForeground)
            Spacer()
            addToListButton(recipe)
        }
    }

    // MARK: Header

    private func header(_ recipe: Recipe) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    if recipe.cuisine != nil || recipe.difficulty != nil {
                        HStack(spacing: 0) {
                            if let cuisine = recipe.cuisine {
                                Button(cuisine.uppercased()) { nav.recipeTag = .cuisine(cuisine) }
                                    .accessibilityHint("Shows other \(cuisine) recipes")
                            }
                            if recipe.cuisine != nil && recipe.difficulty != nil { Text(" · ") }
                            if let difficulty = recipe.difficulty {
                                Button(difficulty.rawValue.uppercased()) { nav.recipeTag = .difficulty(difficulty) }
                                    .accessibilityHint("Shows other \(difficulty.rawValue) recipes")
                            }
                        }
                        .buttonStyle(.plain)
                        .font(Theme.overline)
                        .tracking(1.1)
                        .foregroundStyle(Theme.brand)
                    }
                    Text(recipe.title)
                        .font(Theme.serif(width == .regular ? 34 : 30))
                        .foregroundStyle(Theme.foreground)
                }
                Spacer(minLength: 4)
                Button {
                    Task { await app.toggleFavourite(recipe) }
                } label: {
                    Image(systemName: recipe.isFavourite ? "heart.fill" : "heart")
                        .font(.system(size: 22))
                        .foregroundStyle(recipe.isFavourite ? Theme.heart : Theme.mutedForeground)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(recipe.isFavourite ? "Remove from favourites" : "Add to favourites")
            }
            RecipeRoleBadge(role: recipe.mealRole) { choosingRole = true }
            stats(recipe)
        }
    }

    /// Time and servings, divided by hairlines.
    @ViewBuilder
    private func stats(_ recipe: Recipe) -> some View {
        let time = Format.shortMinutes(recipe.totalMinutes)
        if time != nil || recipe.servings != nil {
            HStack(spacing: 0) {
                if let time {
                    stat("Time", time, icon: "clock")
                }
                if time != nil && recipe.servings != nil {
                    Rectangle().fill(Theme.border).frame(width: 1).padding(.vertical, 2).padding(.trailing, 14)
                }
                if let base = recipe.servings {
                    stat("Serves", Self.servingsText(servings ?? base, unit: recipe.servingsUnit), icon: "person.2")
                        .accessibilityLabel("\(Format.amount(String(servings ?? base)) ?? "") \(recipe.servingsUnit ?? "servings")")
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            .padding(.vertical, 12)
            .overlay(alignment: .top) { Rectangle().fill(Theme.border).frame(height: 1) }
            .overlay(alignment: .bottom) { Rectangle().fill(Theme.border).frame(height: 1) }
        }
    }

    private func stat(_ label: String, _ value: String, icon: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            SectionLabel(text: label)
            Label(value, systemImage: icon)
                .labelStyle(TightLabel())
                .font(Theme.serif(18))
                .foregroundStyle(Theme.foreground)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func controls(_ recipe: Recipe) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if let base = recipe.servings, base > 0 {
                let current = servings ?? base
                HStack(spacing: 14) {
                    Image(systemName: "person.2").foregroundStyle(Theme.mutedForeground)
                    Button { servings = max(1, current - 1) } label: { Image(systemName: "minus") }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Fewer servings")
                    Text(Self.servingsText(current, unit: recipe.servingsUnit))
                        .font(.system(size: 15, weight: .semibold))
                        .monospacedDigit()
                        .accessibilityLabel("\(Format.amount(String(current)) ?? "") \(recipe.servingsUnit ?? "servings")")
                    Button { servings = min(50, current + 1) } label: { Image(systemName: "plus") }
                        .buttonStyle(.plain)
                        .accessibilityLabel("More servings")
                }
                .foregroundStyle(Theme.foreground)
                .padding(.horizontal, 16)
                .frame(height: 44)
                .background(Theme.secondary, in: Capsule())
            }
            Button {
                nav.cooking = CookRequest(dishes: [CookDish(recipe: recipe, scale: scale(recipe))])
            } label: {
                Label("Start Cooking", systemImage: "frying.pan")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(PillButtonStyle(kind: .primary, height: 52))
            .disabled(recipe.steps.isEmpty)
            .frame(maxWidth: width == .regular ? 360 : .infinity)
        }
    }

    // MARK: Menu

    private func actionsMenu(_ recipe: Recipe) -> some View {
        Menu {
            Menu("Add to collection", systemImage: "folder.badge.plus") {
                ForEach(app.collections) { collection in
                    Button("\(collection.icon.map { "\($0) " } ?? "")\(collection.name)",
                           systemImage: collection.recipeIds.contains(recipe.id) ? "checkmark" : "") {
                        Task { await app.toggle(recipe, in: collection) }
                    }
                }
                Divider()
                Button("New collection…", systemImage: "plus") { naming = true }
            }
            Button("Add to shopping list", systemImage: "cart.badge.plus") {
                Task { await app.addToShopping(recipe, servings: servings ?? recipe.servings) }
            }
            Button("Log a cook", systemImage: "square.and.pencil") { logging = true }
            Divider()
            toolsMenu(recipe) { picked in run(picked, recipe) }
            Divider()
            Button("Edit recipe", systemImage: "pencil") { editing = true }
            Button("Delete recipe", systemImage: "trash", role: .destructive) { confirmDelete = true }
        } label: {
            Label("More", systemImage: "ellipsis")
        }
    }

    /// Nutrition runs straight away; the rest open their sheet.
    private func run(_ picked: RecipeTool, _ recipe: Recipe) {
        switch picked {
        case .nutrition:
            app.toast = "Estimating nutrition…"
            Task { if await WebAction.run("ai.estimateNutrition", [.string(recipe.id)], done: "Nutrition estimated.") { await app.syncNow() } }
        default:
            tool = picked
        }
    }

    private func delete() async {
        do {
            try await app.api.deleteRecipe(id: recipeId)
            app.toast = "Recipe deleted."
            await app.syncNow()
            dismissPage()
        } catch {
            app.toast = app.online ? "Couldn’t delete the recipe." : "You’re offline — try again with a connection."
        }
    }

    // MARK: Rating, history, related

    /// ★★★★½ 4.5/5, then "Cooked 3×, last today · Planned 2×". Log a cook
    /// lives in Cook history further down and in the More menu.
    private func ratingRow(_ recipe: Recipe) -> some View {
        let e = extras.value
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                StarRating(value: e.averageRating, size: 16)
                if let avg = e.averageRating {
                    Text("\(Format.amount(String((avg / 2 * 10).rounded() / 10)) ?? "")/5")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.mutedForeground)
                }
            }
            let parts = [
                e.cookCount > 0 ? "Cooked \(e.cookCount)×" + (e.lastCooked.map { ", last \(Self.relative($0))" } ?? "") : nil,
                e.plannedCount > 0 ? "Planned \(e.plannedCount)×" : nil,
            ].compactMap { $0 }
            if !parts.isEmpty {
                Label(parts.joined(separator: " · "), systemImage: "calendar")
                    .labelStyle(TightLabel())
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.mutedForeground)
                    .lineLimit(1)
            }
        }
    }

    private func addToListButton(_ recipe: Recipe) -> some View {
        Button {
            Task { await app.addToShopping(recipe, servings: servings ?? recipe.servings) }
        } label: {
            Label("Add to shopping list", systemImage: "cart.badge.plus")
        }
        .buttonStyle(.secondary)
    }

    /// Every logged cook, newest first, as the web's cook-history entries.
    @ViewBuilder
    private func history(_ recipe: Recipe) -> some View {
        let entries = extras.value.entries
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Cook history").font(.system(size: 19, weight: .bold))
                if !entries.isEmpty {
                    Text("\(entries.count)").font(.system(size: 14)).foregroundStyle(Theme.mutedForeground)
                }
                Spacer()
                Button { logging = true } label: { Label("Log a cook", systemImage: "plus") }
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.brand)
            }
            if entries.isEmpty {
                EmptyBox(emoji: "📖", message: "Not cooked yet — log it after you make it")
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 320), spacing: 12, alignment: .top)], spacing: 12) {
                    ForEach(entries) { CookEntryCard(entry: $0) }
                }
            }
        }
        .padding(.top, 10)
    }

    @ViewBuilder
    private var related: some View {
        let similar = extras.value.related
        if !similar.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Text("You might also like").font(.system(size: 19, weight: .bold))
                RecipeGrid(recipes: similar, maxRows: 1) { recipe in
                    NavigationLink(value: recipe.id) { RecipeCard(recipe: recipe) }
                        .buttonStyle(.plain)
                }
            }
            .padding(.top, 10)
        }
    }

    /// "4" beside the people icon, which says servings on its own; a unit
    /// that isn't people (12 muffins) keeps its word.
    static func servingsText(_ n: Double, unit: String?) -> String {
        let count = Format.amount(String(n)) ?? ""
        guard let unit = unit?.trimmingCharacters(in: .whitespaces), !unit.isEmpty,
              !["serving", "servings", "people", "person", "persons", "portion", "portions"].contains(unit.lowercased())
        else { return count }
        return "\(count) \(unit)"
    }

    static func relative(_ date: Date) -> String {
        let days = Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: date),
                                                   to: Calendar.current.startOfDay(for: .now)).day ?? 0
        switch days {
        case ..<1: return "today"
        case 1: return "yesterday"
        case 2..<7: return "\(days) days ago"
        case 7..<14: return "last week"
        case 14..<31: return "\(days / 7) weeks ago"
        default: return date.formatted(.dateTime.day().month(.abbreviated).year())
        }
    }

    // MARK: Tabs

    private func tabs(_ recipe: Recipe) -> some View {
        HStack(spacing: 0) {
            tabButton("Overview", .overview)
            tabButton("Ingredients (\(recipe.ingredients.count))", .ingredients)
            tabButton("Steps (\(recipe.steps.count))", .steps)
        }
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.border).frame(height: 1) }
    }

    private func tabButton(_ title: String, _ value: Tab, selected: Tab? = nil) -> some View {
        let on = (selected ?? tab) == value
        return Button { withAnimation(.snappy) { tab = value } } label: {
            Text(title)
                .font(Theme.serif(16))
                .foregroundStyle(on ? Theme.brand : Theme.mutedForeground)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity)
                .overlay(alignment: .bottom) {
                    Rectangle().fill(on ? Theme.brand : .clear).frame(height: 2)
                }
        }
        .buttonStyle(.plain)
    }

    private func overview(_ recipe: Recipe) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            if let description = recipe.description, !description.isEmpty {
                Text(description).font(Theme.serif(17, weight: .regular, italic: true)).foregroundStyle(Theme.foreground.opacity(0.8))
            }
            HStack(spacing: 28) {
                timeColumn("Prep", recipe.prepTimeMinutes)
                timeColumn("Cook", recipe.cookTimeMinutes)
                timeColumn("Total", recipe.totalMinutes)
                Spacer()
            }
            .padding(16)
            .background(Theme.muted.opacity(0.6), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            if !recipe.tags.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(recipe.tags, id: \.self) { BadgeView(text: $0) }
                }
            }
        }
    }

    private func timeColumn(_ label: String, _ minutes: Int?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.foreground)
            Text(Format.shortMinutes(minutes) ?? "—").font(.system(size: 14)).foregroundStyle(Theme.mutedForeground)
        }
    }

    // MARK: Ingredients and steps

    private func ingredients(_ recipe: Recipe) -> some View {
        let scale = scale(recipe)
        return VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(grouped(recipe.ingredients, label: \.groupLabel).enumerated()), id: \.offset) { _, group in
                if let label = group.label {
                    SectionLabel(text: label, brand: true).padding(.top, 6)
                }
                ForEach(group.items) { ingredient in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Circle().fill(Theme.brand).frame(width: 6, height: 6)
                        let quantity = Text(Format.quantity(ingredient.amount, ingredient.unit, scale: scale))
                            .font(.system(size: 16, weight: .semibold))
                        let extra = Text([ingredient.preparation.map { ", \($0)" }, ingredient.isOptional ? " (optional)" : nil]
                            .compactMap { $0 }.joined())
                            .foregroundStyle(Theme.mutedForeground)
                        Text("\(quantity) \(ingredient.name)\(extra)")
                            .font(.system(size: 16))
                            .foregroundStyle(Theme.foreground)
                    }
                }
            }
        }
    }

    private func steps(_ recipe: Recipe) -> some View {
        let numbered = recipe.steps.enumerated().map { NumberedStep(number: $0.offset + 1, step: $0.element) }
        return VStack(alignment: .leading, spacing: 16) {
            ForEach(Array(grouped(numbered, label: \.step.groupLabel).enumerated()), id: \.offset) { _, group in
                if let label = group.label {
                    SectionLabel(text: label, brand: true)
                }
                ForEach(group.items) { item in
                    HStack(alignment: .top, spacing: 14) {
                        Text("\(item.number)")
                            .font(Theme.serif(16))
                            .foregroundStyle(Theme.brand)
                            .frame(width: 30, height: 30)
                            .background(Theme.highlight, in: Circle())
                        VStack(alignment: .leading, spacing: 6) {
                            Text(item.step.instruction).font(.system(size: 16)).foregroundStyle(Theme.foreground)
                            if let minutes = Format.minutes(item.step.durationMinutes) {
                                Label([item.step.timerLabel, minutes].compactMap { $0 }.joined(separator: " · "),
                                      systemImage: "timer")
                                    .labelStyle(TightLabel())
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundStyle(Theme.brand)
                            }
                        }
                    }
                }
            }
        }
    }
}

private struct NumberedStep: Identifiable {
    var number: Int
    var step: RecipeStep
    var id: String { step.id }
}

/// Consecutive runs that share a section label, in order (recipe sections).
private func grouped<T>(_ items: [T], label: KeyPath<T, String?>) -> [(label: String?, items: [T])] {
    var out: [(label: String?, items: [T])] = []
    for item in items {
        let l = item[keyPath: label]
        if let last = out.last, last.label == l { out[out.count - 1].items.append(item) } else { out.append((l, [item])) }
    }
    return out
}

/// What the recipe page shows besides the recipe, read from the device:
/// its cooks and ratings, how often it's been planned, and similar recipes
/// (same cuisine or shared tags).
struct RecipeExtras: Sendable {
    var entries: [CookEntry] = []
    var cookCount = 0
    var lastCooked: Date?
    var averageRating: Double?
    var plannedCount = 0
    var related: [Recipe] = []

    static func load(_ r: StoreReader, recipeId: String) throws -> RecipeExtras {
        var x = RecipeExtras()
        x.entries = try r.records(.cookHistory).compactMap(CookEntry.init)
            .filter { $0.recipeId == recipeId }
            .sorted { $0.cookedAt > $1.cookedAt }
        let cooks = x.entries.filter(\.isCook)
        x.cookCount = cooks.count
        x.lastCooked = cooks.first?.cookedAt
        let ratings = x.entries.compactMap(\.rating)
        x.averageRating = ratings.isEmpty ? nil : ratings.reduce(0, +) / Double(ratings.count)

        let plans = Dictionary(try r.records(.mealPlans).compactMap(MealPlan.init).map { ($0.id, $0.weekStartDate) },
                               uniquingKeysWith: { a, _ in a })
        let weeks = try r.records(.mealPlanEntries).compactMap(MealPlanEntry.init)
            .filter { $0.recipeId == recipeId }
            .compactMap { plans[$0.mealPlanId] }
        x.plannedCount = weeks.count

        let all = try r.records(.recipes).compactMap(Recipe.init)
        if let this = all.first(where: { $0.id == recipeId }) {
            let tags = Set(this.tags)
            x.related = all
                .filter { $0.id != recipeId }
                .map { other in (other, (other.cuisine != nil && other.cuisine == this.cuisine ? 2 : 0) + tags.intersection(other.tags).count) }
                .filter { $0.1 > 0 }
                .sorted { ($0.1, $0.0.title) > ($1.1, $1.0.title) }
                .prefix(8)
                .map(\.0)
        }
        return x
    }
}

/// One logged cook: when, the stars, who ate it and what they thought, notes,
/// and the photo if there is one. Edit and Delete in its menu (⋯, or a long
/// press), as the web's history entry.
struct CookEntryCard: View {
    @Environment(AppModel.self) private var app
    let entry: CookEntry
    var recipeTitle: String?
    @State private var confirmDelete = false
    /// The recipe, loaded when Edit is chosen (the review form needs it).
    @State private var editing: Recipe?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if let url = app.imageURL(entry.photoUrl) {
                AsyncImage(url: url) { phase in
                    if let image = phase.image { image.resizable().scaledToFill() } else { Theme.muted }
                }
                .frame(width: 76, height: 76)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            VStack(alignment: .leading, spacing: 4) {
                // Title (History only) and date on the left; rating and the
                // actions menu pinned top-right so the text column keeps its width.
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        if let recipeTitle {
                            Text(recipeTitle).font(.system(size: 15, weight: .semibold)).lineLimit(2)
                        }
                        Text(entry.isCook ? RecipeDetailView.relative(entry.cookedAt).capitalizedFirst : "Rated")
                            .font(.system(size: recipeTitle == nil ? 15 : 13, weight: recipeTitle == nil ? .semibold : .regular))
                            .foregroundStyle(recipeTitle == nil ? Theme.foreground : Theme.mutedForeground)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 4)
                    if let rating = entry.rating {
                        HStack(spacing: 3) {
                            Image(systemName: "star.fill").font(.system(size: 11)).foregroundStyle(Self.star)
                            Text(Format.amount(String(rating / 2)) ?? "").font(.system(size: 13, weight: .semibold))
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("Rated \(Format.amount(String(rating / 2)) ?? "") out of 5")
                    }
                    Menu { menu } label: {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Theme.mutedForeground)
                            .frame(width: 40, height: 36)
                            .contentShape(Rectangle())
                    }
                    // A finger-sized target without pushing the glyph inward or the rows down.
                    .padding(.trailing, -8)
                    .padding(.vertical, -8)
                    .accessibilityLabel("Cook actions")
                }
                if !meta.isEmpty {
                    Text(meta).font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                }
                if !entry.cookedFor.isEmpty {
                    people.font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                }
                if let notes = entry.notes, !notes.isEmpty {
                    Text(notes).font(.system(size: 13)).foregroundStyle(Theme.foreground.opacity(0.8)).lineLimit(3)
                        .padding(.top, 2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .contentShape(Rectangle())
        .onTapGesture { Task { await edit() } }
        .contextMenu { menu }
        .confirmationDialog("Delete this cook?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { Task { await app.deleteCook(entry) } }
        } message: {
            Text("It’s taken out of the recipe’s history and ratings.")
        }
        .sheet(item: $editing) { recipe in
            CookReviewSheet(recipe: recipe, mode: .edit(entry)).presentationSizing(.page)
        }
    }

    private static let star = Theme.brand

    /// "20 min · Family dinner": plain text, so it wraps rather than truncating.
    private var meta: String {
        [Format.minutes(entry.actualDuration), entry.occasion?.trimmingCharacters(in: .whitespaces)]
            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// Who ate it, by first name, with their own rating in terracotta where they gave one.
    private var people: Text {
        let byName = Dictionary(entry.memberRatings.map { ($0.name, $0.rating) }, uniquingKeysWith: { a, _ in a })
        let first = entry.cookedFor.map { $0.split(separator: " ").first.map(String.init) ?? $0 }
        // Two people sharing a first name keep their full names.
        let names = Set(first).count == first.count ? first : entry.cookedFor
        var text = Text(Image(systemName: "person.2"))
        for (i, full) in entry.cookedFor.enumerated() {
            text = Text("\(text)\(i == 0 ? " " : ", ")\(names[i])")
            if let r = byName[full] {
                text = Text("\(text) \(Text("★\(Format.amount(String(r / 2)) ?? "")").foregroundStyle(Self.star))")
            }
        }
        return text
    }

    @ViewBuilder private var menu: some View {
        Button(entry.rating == nil && entry.isCook ? "Review" : "Edit", systemImage: "pencil") { Task { await edit() } }
        Button("Delete", systemImage: "trash", role: .destructive) { confirmDelete = true }
    }

    private func edit() async {
        let id = entry.recipeId
        editing = try? await app.store.read { r in try r.record(.recipes, id: id).flatMap(Recipe.init) }
        if editing == nil { app.toast = "That recipe isn’t on this device." }
    }
}

extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}

