// Saved meals, as the web's /meals: a meal made of slots (a main, sides, a
// sauce…), each with one or more recipe options and a default. Planning one
// (Planner → Add meal → Saved meals) picks an option per slot. The list comes
// from the device (saved meals sync); creating and editing need a connection.

import DishesCore
import SwiftUI

struct SavedMealsScreen: View {
    @Environment(AppModel.self) private var app
    @State private var meals = Observed<[SavedMeal]>([])
    @State private var editing: MealDraft?
    /// How each meal has gone down when cooked as a whole (the meal review), by id.
    @State private var ratings: [String: MealRating] = [:]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                PageHeader(title: "Saved meals", subtitle: "Combinations you make again — a main with its sides and sauces.") {
                    Button { editing = MealDraft() } label: {
                        Label("New meal", systemImage: "plus")
                            .font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.brandForeground)
                            .padding(.horizontal, 14).frame(height: 38)
                            .background(Theme.brand, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
                if meals.loaded && meals.value.isEmpty {
                    EmptyBox(emoji: "🍽️", message: "No saved meals yet. Save one from a combined meal on the planner, or make one here.")
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 12, alignment: .top)], spacing: 12) {
                    ForEach(meals.value) { meal in
                        Button { editing = MealDraft(meal) } label: { card(meal) }
                            .buttonStyle(.plain).foregroundStyle(Theme.foreground)
                    }
                }
            }
            .padding(20)
            .frame(maxWidth: 900).frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationBarTitleDisplayMode(.inline)
        .task { await meals.follow(app.store) { r in try r.records(.meals).compactMap(SavedMeal.init).sorted { $0.title < $1.title } } }
        .task {
            // Ratings come from the server (meal cooks don't sync); offline, they just don't show.
            struct Row: Decodable, Sendable { var id: String; var rating: MealRating? }
            if let rows = try? await app.api.action("meals.list", as: [Row].self) {
                ratings = Dictionary(rows.compactMap { r in r.rating.map { (r.id, $0) } }, uniquingKeysWith: { a, _ in a })
            }
        }
        .sheet(item: $editing) { draft in MealEditor(draft: draft).presentationSizing(.page) }
    }

    /// The meal's average, and its best and lowest combination once it's been made more than one way.
    private func ratingLine(_ r: MealRating) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                if let avg = r.average {
                    StarRating(value: avg * 2, size: 12)
                    Text(String(format: "%.1f", avg)).font(.system(size: 12, weight: .semibold))
                } else {
                    Text("Not rated yet").font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
                }
                Text("· cooked \(r.cookCount) time\(r.cookCount == 1 ? "" : "s")")
                    .font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
            }
            if r.combinations.count > 1, let best = r.combinations.first, let worst = r.combinations.last {
                Text("\(Text("Best \(String(format: "%.1f", best.average))★").bold().foregroundStyle(Theme.success)) \(best.titles.joined(separator: " + "))")
                    .font(.system(size: 12)).foregroundStyle(Theme.mutedForeground).lineLimit(2)
                Text("\(Text("Lowest \(String(format: "%.1f", worst.average))★").bold().foregroundStyle(Theme.brand)) \(worst.titles.joined(separator: " + "))")
                    .font(.system(size: 12)).foregroundStyle(Theme.mutedForeground).lineLimit(2)
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.7), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func card(_ meal: SavedMeal) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                MealTypePill(type: meal.defaultMealType)
                Text(meal.title).font(.system(size: 17, weight: .bold))
                Spacer()
            }
            if let rating = ratings[meal.id] { ratingLine(rating) }
            ForEach(meal.slots) { slot in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text((slot.label ?? slot.role ?? "Dish").capitalizedFirst)
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.brand)
                        .frame(width: 70, alignment: .leading)
                    Text(slot.options.map(\.title).joined(separator: " / "))
                        .font(.system(size: 14)).lineLimit(2)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
    }
}

/// A saved meal being edited, in the shape the web's action takes.
struct MealDraft: Identifiable {
    struct Option: Hashable { var recipeId: String; var title: String; var isDefault: Bool }
    struct Slot: Identifiable, Hashable {
        let id = UUID()
        var role = "main"
        var label = ""
        var allowMultiple = false
        var options: [Option] = []
    }
    let id = UUID()
    var mealId: String?
    var title = ""
    var notes = ""
    var mealType = "dinner"
    var slots: [Slot] = [Slot()]

    init() {}

    init(_ meal: SavedMeal) {
        mealId = meal.id
        title = meal.title
        mealType = meal.defaultMealType
        slots = meal.slots.map { s in
            Slot(role: s.role ?? "main", label: s.label ?? "", allowMultiple: s.allowMultiple,
                 options: s.options.map { Option(recipeId: $0.recipeId, title: $0.title, isDefault: $0.isDefault) })
        }
    }

    var json: JSONValue {
        .object([
            "title": .string(title),
            "notes": notes.isEmpty ? .null : .string(notes),
            "defaultMealType": .string(mealType),
            "slots": .array(slots.filter { !$0.options.isEmpty }.map { s in
                .object([
                    "role": .string(s.role),
                    "label": s.label.isEmpty ? .null : .string(s.label),
                    "allowMultiple": .bool(s.allowMultiple),
                    "options": .array(s.options.map { .object(["recipeId": .string($0.recipeId), "isDefault": .bool($0.isDefault)]) }),
                ])
            }),
        ])
    }
}

private struct MealEditor: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State var draft: MealDraft
    @State private var picking: UUID?
    @State private var confirmDelete = false
    @State private var saving = false

    static let roles = [("main", "Main"), ("side", "Side"), ("sauce", "Sauce"), ("other", "Other")]

    var body: some View {
        NavigationStack {
            Form {
                TextField("Meal name (e.g. Sunday roast)", text: $draft.title)
                Picker("Usually for", selection: $draft.mealType) {
                    ForEach(["breakfast", "lunch", "dinner", "dessert", "snack"], id: \.self) { Text($0.capitalized).tag($0) }
                }
                ForEach($draft.slots) { $slot in
                    Section {
                        Picker("Role", selection: $slot.role) { ForEach(Self.roles, id: \.0) { Text($0.1).tag($0.0) } }
                        TextField("Label (optional, e.g. Potatoes)", text: $slot.label)
                        Toggle("Can have more than one", isOn: $slot.allowMultiple).tint(Theme.brand)
                        ForEach(Array(slot.options.enumerated()), id: \.element.recipeId) { index, option in
                            HStack {
                                Button {
                                    for i in slot.options.indices { slot.options[i].isDefault = slot.allowMultiple ? (i == index ? !slot.options[i].isDefault : slot.options[i].isDefault) : i == index }
                                } label: {
                                    Image(systemName: option.isDefault ? "star.fill" : "star").foregroundStyle(option.isDefault ? Theme.brand : Theme.mutedForeground)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(option.isDefault ? "Default" : "Make default")
                                Text(option.title)
                                Spacer()
                                Button(role: .destructive) { slot.options.remove(at: index) } label: { Image(systemName: "minus.circle") }
                                    .buttonStyle(.plain).foregroundStyle(Theme.destructive)
                            }
                        }
                        Button { picking = slot.id } label: { Label("Add a recipe option", systemImage: "plus") }
                    } header: {
                        HStack {
                            Text(slot.label.isEmpty ? Self.roles.first { $0.0 == slot.role }?.1 ?? "Dish" : slot.label)
                            Spacer()
                            if draft.slots.count > 1 {
                                Button("Remove") { draft.slots.removeAll { $0.id == slot.id } }.font(.caption)
                            }
                        }
                    } footer: { Text("★ marks the default the planner picks.") }
                }
                Button { draft.slots.append(MealDraft.Slot(role: "side")) } label: { Label("Add a slot (side, sauce…)", systemImage: "plus.rectangle.on.rectangle") }
                Section("Notes") { TextField("Anything to remember", text: $draft.notes, axis: .vertical) }
                if draft.mealId != nil {
                    Button("Delete saved meal", role: .destructive) { confirmDelete = true }
                }
            }
            .navigationTitle(draft.mealId == nil ? "New saved meal" : "Edit saved meal").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") { Task { await save() } }.bold()
                        .disabled(saving || draft.title.trimmingCharacters(in: .whitespaces).isEmpty || draft.slots.allSatisfy(\.options.isEmpty))
                }
            }
            .sheet(item: Binding(get: { picking.map { PickTarget(id: $0) } }, set: { picking = $0?.id })) { target in
                RecipePickerSheet { recipe in
                    guard let i = draft.slots.firstIndex(where: { $0.id == target.id }) else { return }
                    guard !draft.slots[i].options.contains(where: { $0.recipeId == recipe.id }) else { return }
                    draft.slots[i].options.append(.init(recipeId: recipe.id, title: recipe.title, isDefault: draft.slots[i].options.isEmpty))
                }
            }
            .task {
                // Notes don't sync to the device; fetch them so saving keeps them.
                struct Row: Decodable, Sendable { var id: String; var notes: String? }
                guard let id = draft.mealId, draft.notes.isEmpty,
                      let rows = try? await app.api.action("meals.list", as: [Row].self) else { return }
                draft.notes = rows.first { $0.id == id }?.notes ?? ""
            }
            .confirmationDialog("Delete \(draft.title)?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    Task {
                        if let id = draft.mealId, await WebAction.run("meals.delete", [.string(id)]) { await app.syncNow(); dismiss() }
                    }
                }
            } message: { Text("Meals already on the plan stay.") }
        }
    }

    private struct PickTarget: Identifiable { let id: UUID }

    private func save() async {
        saving = true
        defer { saving = false }
        let ok = if let id = draft.mealId {
            await WebAction.run("meals.update", [.string(id), draft.json], done: "Saved meal updated.")
        } else {
            await WebAction.run("meals.create", [draft.json], done: "Saved meal created.")
        }
        if ok { await app.syncNow(); dismiss() }
    }
}

/// Pick a recipe from the device's library.
struct RecipePickerSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    var picked: (Recipe) -> Void
    @State private var recipes = Observed<[Recipe]>([])
    @State private var search = ""

    var body: some View {
        NavigationStack {
            List {
                ForEach(recipes.value.filter { search.isEmpty || $0.title.localizedCaseInsensitiveContains(search) }) { recipe in
                    Button { picked(recipe); dismiss() } label: {
                        HStack(spacing: 12) {
                            RecipeImage(recipe: recipe).frame(width: 44, height: 44)
                                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(recipe.title).foregroundStyle(Theme.foreground)
                                if let c = recipe.cuisine { Text(c).font(.caption).foregroundStyle(.secondary) }
                            }
                        }
                    }
                }
            }
            .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always))
            .navigationTitle("Choose a recipe").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .task { await recipes.follow(app.store) { r in try r.records(.recipes).compactMap(Recipe.init).sorted { $0.title < $1.title } } }
    }
}

/// A saved meal's ratings from its meal reviews (lib/services/meal-cooks.ts).
struct MealRating: Decodable, Sendable, Hashable {
    struct Combination: Decodable, Sendable, Hashable { var titles: [String]; var average: Double; var count: Int }
    var average: Double?
    var cookCount: Int
    var combinations: [Combination]
}
