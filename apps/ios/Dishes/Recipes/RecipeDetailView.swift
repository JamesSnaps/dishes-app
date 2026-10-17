// One recipe, laid out as the web's /recipes/[id]: title and heart, badges for
// cuisine, difficulty, time and servings, the servings stepper, Start Cooking,
// nutrition when there is some, then Overview / Ingredients / Steps tabs with
// the orange underline. When the page is wide enough (iPad landscape, or
// portrait without the sidebar) the ingredients sit beside the method instead
// of behind a tab — decided by the space, not the device.
//
// Below the header: the household's rating and how often it's been cooked and
// planned, with Log a cook; the full nutrition panel; Add to shopping list on
// the ingredients; and, after the method, every logged cook and a few
// recipes like this one — all from the device's copy.
//
// Scaling multiplies amounts and shows kitchen fractions; unit promotion
// (1000 g → 1 kg) comes with the lib/scale-ingredient.ts port (C2).

import DishesCore
import SwiftUI

struct RecipeDetailView: View {
    @Environment(AppModel.self) private var app
    @Environment(AppNav.self) private var nav
    @Environment(\.horizontalSizeClass) private var width
    let recipeId: String
    @State private var recipe = Observed<Recipe?>(nil)
    @State private var extras = Observed(RecipeExtras())
    @State private var logging = false
    @State private var editing = false
    @State private var confirmDelete = false
    @State private var naming = false
    @State private var newCollection = ""
    @Environment(\.dismiss) private var dismissPage
    @State private var servings: Double?
    @State private var tab = Tab.ingredients
    @State private var pageWidth: CGFloat = 0

    /// Room for a 330pt ingredients column and a readable method beside it.
    private var sideBySide: Bool { pageWidth >= 760 }

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
            if let recipe = recipe.value { LogCookSheet(recipe: recipe) }
        }
        .sheet(isPresented: $editing) { RecipeEditor(recipeId: recipeId) }
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
                if recipe.imageUrl != nil {
                    Color.clear
                        .aspectRatio(width == .regular ? 2.4 : 1.6, contentMode: .fit)
                        .overlay { RecipeImage(recipe: recipe, thumbnail: false) }
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                header(recipe)
                ratingRow(recipe)
                controls(recipe)
                NutritionPanel(recipe: recipe)

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
                        HStack {
                            Text("\(recipe.ingredients.count) ingredients").font(.system(size: 14)).foregroundStyle(Theme.mutedForeground)
                            Spacer()
                            addToListButton(recipe)
                        }
                        ingredients(recipe)
                    case .steps: steps(recipe)
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

    // MARK: Header

    private func header(_ recipe: Recipe) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                Text(recipe.title)
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(Theme.foreground)
                Spacer(minLength: 4)
                Button {
                    Task { await app.toggleFavourite(recipe) }
                } label: {
                    Image(systemName: recipe.isFavourite ? "heart.fill" : "heart")
                        .font(.system(size: 22))
                        .foregroundStyle(recipe.isFavourite ? Theme.heart : Theme.mutedForeground)
                        .frame(width: 40, height: 40)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(recipe.isFavourite ? "Remove from favourites" : "Add to favourites")
            }
            HStack(spacing: 10) {
                if let cuisine = recipe.cuisine { BadgeView(text: cuisine) }
                if let difficulty = recipe.difficulty { BadgeView(text: difficulty.rawValue.capitalized, style: .outline) }
                if let time = Format.shortMinutes(recipe.totalMinutes) {
                    Label(time, systemImage: "clock").labelStyle(TightLabel())
                }
                if let base = recipe.servings {
                    Label("\(Format.amount(String(servings ?? base)) ?? "") \(recipe.servingsUnit ?? "servings")",
                          systemImage: "person.2")
                        .labelStyle(TightLabel())
                }
            }
            .font(.system(size: 14))
            .foregroundStyle(Theme.mutedForeground)
        }
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
                    Text("\(Format.amount(String(current)) ?? "") \(recipe.servingsUnit ?? "servings")")
                        .font(.system(size: 15, weight: .semibold))
                        .monospacedDigit()
                    Button { servings = min(50, current + 1) } label: { Image(systemName: "plus") }
                        .buttonStyle(.plain)
                        .accessibilityLabel("More servings")
                }
                .foregroundStyle(Theme.foreground)
                .padding(.horizontal, 16)
                .frame(height: 44)
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.border))
            }
            Button {
                nav.cooking = CookRequest(dishes: [CookDish(recipe: recipe, scale: scale(recipe))])
            } label: {
                Label("Start Cooking", systemImage: "frying.pan")
            }
            .buttonStyle(.brand)
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
            Button("Edit recipe", systemImage: "pencil") { editing = true }
            Button("Delete recipe", systemImage: "trash", role: .destructive) { confirmDelete = true }
        } label: {
            Label("More", systemImage: "ellipsis")
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

    /// ★★★★½ 4.5/5 · Cooked 3 times · On the menu twice — and Log a cook.
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
                Button { logging = true } label: {
                    Label("Log a cook", systemImage: "square.and.pencil")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Theme.foreground)
                }
                .buttonStyle(.plain)
                .padding(.leading, 6)
            }
            let parts = [
                e.cookCount > 0 ? "Cooked \(Self.times(e.cookCount))" + (e.lastCooked.map { " · last \(Self.relative($0))" } ?? "") : nil,
                e.plannedCount > 0 ? "On the menu \(Self.times(e.plannedCount))" + (e.lastPlannedWeek.map { " · last planned week of \($0)" } ?? "") : nil,
            ].compactMap { $0 }
            if !parts.isEmpty {
                Label(parts.joined(separator: " · "), systemImage: "calendar")
                    .labelStyle(TightLabel())
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.mutedForeground)
            }
        }
    }

    private func addToListButton(_ recipe: Recipe) -> some View {
        Button {
            Task { await app.addToShopping(recipe, servings: servings ?? recipe.servings) }
        } label: {
            Label("Add to shopping list", systemImage: "cart.badge.plus")
        }
        .buttonStyle(.outline)
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

    static func times(_ n: Int) -> String { n == 1 ? "once" : n == 2 ? "twice" : "\(n) times" }

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

    private func tabButton(_ title: String, _ value: Tab) -> some View {
        Button { withAnimation(.snappy) { tab = value } } label: {
            Text(title)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(tab == value ? Theme.brand : Theme.mutedForeground)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity)
                .overlay(alignment: .bottom) {
                    Rectangle().fill(tab == value ? Theme.brand : .clear).frame(height: 2)
                }
        }
        .buttonStyle(.plain)
    }

    private func overview(_ recipe: Recipe) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            if let description = recipe.description, !description.isEmpty {
                Text(description).font(.system(size: 16)).foregroundStyle(Theme.foreground.opacity(0.75))
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
                    Text(label).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.brand).padding(.top, 6)
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
                    Text(label).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.brand)
                }
                ForEach(group.items) { item in
                    HStack(alignment: .top, spacing: 14) {
                        Text("\(item.number)")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Theme.brandDeep)
                            .frame(width: 28, height: 28)
                            .background(Theme.orange50, in: Circle())
                            .overlay(Circle().strokeBorder(Color(hex: 0xFED7AA)))
                        VStack(alignment: .leading, spacing: 6) {
                            Text(item.step.instruction).font(.system(size: 16)).foregroundStyle(Theme.foreground)
                            if let minutes = Format.minutes(item.step.durationMinutes) {
                                Label([item.step.timerLabel, minutes].compactMap { $0 }.joined(separator: " · "),
                                      systemImage: "timer")
                                    .labelStyle(TightLabel())
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundStyle(Theme.brandDeep)
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
    var lastPlannedWeek: String?
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
        if let last = weeks.max(), let date = try? Date.ISO8601FormatStyle().year().month().day().parse(last) {
            x.lastPlannedWeek = date.formatted(.dateTime.day().month(.abbreviated))
        }

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
/// and the photo if there is one. Long-press to delete.
struct CookEntryCard: View {
    @Environment(AppModel.self) private var app
    let entry: CookEntry
    var recipeTitle: String?
    @State private var confirmDelete = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if let url = app.imageURL(entry.photoUrl) {
                AsyncImage(url: url) { phase in
                    if let image = phase.image { image.resizable().scaledToFill() } else { Theme.muted }
                }
                .frame(width: 72, height: 72)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            VStack(alignment: .leading, spacing: 6) {
                if let recipeTitle {
                    Text(recipeTitle).font(.system(size: 15, weight: .semibold)).lineLimit(2)
                }
                HStack(spacing: 8) {
                    Text(entry.isCook ? RecipeDetailView.relative(entry.cookedAt).capitalizedFirst : "Rated")
                        .font(.system(size: 14, weight: recipeTitle == nil ? .semibold : .regular))
                        .foregroundStyle(recipeTitle == nil ? Theme.foreground : Theme.mutedForeground)
                    if entry.rating != nil { StarRating(value: entry.rating, size: 12) }
                    if let occasion = entry.occasion, !occasion.isEmpty { BadgeView(text: occasion) }
                }
                if !entry.cookedFor.isEmpty {
                    let byName = Dictionary(entry.memberRatings.map { ($0.name, $0.rating) }, uniquingKeysWith: { a, _ in a })
                    FlowLayout(spacing: 6) {
                        ForEach(entry.cookedFor, id: \.self) { name in
                            HStack(spacing: 4) {
                                Text(name).font(.system(size: 12, weight: .medium))
                                if let r = byName[name] {
                                    Image(systemName: "star.fill").font(.system(size: 9)).foregroundStyle(Color(hex: 0xF59E0B))
                                    Text(Format.amount(String(r / 2)) ?? "").font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
                                }
                            }
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(Theme.muted, in: Capsule())
                        }
                    }
                }
                if let notes = entry.notes, !notes.isEmpty {
                    Text(notes).font(.system(size: 13)).foregroundStyle(Theme.foreground.opacity(0.8)).lineLimit(4)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .contextMenu {
            Button("Delete", systemImage: "trash", role: .destructive) { confirmDelete = true }
        }
        .confirmationDialog("Delete this cook?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { Task { await app.deleteCook(entry) } }
        }
    }
}

extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}

