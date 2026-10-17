// Create or edit a recipe: the web editor's fields — title, description,
// cuisine, times, servings, difficulty, role, tags, then ingredients and steps
// in sections, each reorderable. Online: it saves through /api/v1/recipes and
// the next sync brings the server's copy.
//
// A save replaces the whole recipe, so everything this editor doesn't show
// (photo, nutrition, notes, source link, meal types) is carried over from the
// device's copy of the row rather than cleared.
//
// Each step remembers which ingredients it uses (the links cooking mode shows
// as chips). Ingredients get new ids on every save, so the links travel as
// positions in the ingredients list (`ingredientIndexes`) and the server maps
// them to the new ids — they survive reordering, adding and deleting.

import DishesCore
import SwiftUI

struct RecipeEditor: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    /// nil: a new recipe.
    let recipeId: String?
    var onSaved: ((String) -> Void)?

    struct EditIngredient: Identifiable, Hashable {
        var id = UUID()
        var name = "", amount = "", unit = "", preparation = "", group = ""
        var optional = false
    }

    struct EditStep: Identifiable, Hashable {
        let id = UUID()
        var instruction = "", minutes = "", timerLabel = "", group = ""
        /// The editor rows (EditIngredient.id) this step uses.
        var uses: Set<UUID> = []
    }

    @State private var title = ""
    @State private var summary = ""
    @State private var cuisine = ""
    @State private var prep = ""
    @State private var cook = ""
    @State private var servings = "4"
    @State private var servingsUnit = "servings"
    @State private var difficulty = ""
    @State private var role = ""
    @State private var tags = ""
    @State private var ingredients: [EditIngredient] = [EditIngredient()]
    @State private var steps: [EditStep] = [EditStep()]
    /// The device's copy of the row, for the fields this editor leaves alone.
    @State private var original: JSONValue?
    @State private var loaded = false
    @State private var saving = false
    @State private var tab = Tab.details

    /// Three tabs, so no one screen is a long scroll.
    enum Tab: String, CaseIterable { case details = "Details", ingredients = "Ingredients", method = "Method" }

    var body: some View {
        NavigationStack {
            Form {
                switch tab {
                case .details:
                Section("Recipe") {
                    TextField("Title", text: $title)
                        .font(.system(size: 17, weight: .semibold))
                    TextField("Description", text: $summary, axis: .vertical).lineLimit(2...5)
                    TextField("Cuisine (e.g. Italian)", text: $cuisine)
                    Picker("Difficulty", selection: $difficulty) {
                        Text("—").tag("")
                        ForEach(Difficulty.allCases, id: \.rawValue) { Text($0.rawValue.capitalized).tag($0.rawValue) }
                    }
                    Picker("Role", selection: $role) {
                        Text("Not set").tag("")
                        ForEach(["main", "side", "sauce", "other"], id: \.self) { Text(RecipeCard.roleLabels[$0] ?? $0).tag($0) }
                    }
                    TextField("Tags, separated by commas", text: $tags)
                        .textInputAutocapitalization(.never)
                }

                Section("Time and servings") {
                    numberRow("Prep", text: $prep, suffix: "min")
                    numberRow("Cook", text: $cook, suffix: "min")
                    HStack {
                        Text("Serves")
                        Spacer()
                        TextField("4", text: $servings).keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(width: 60)
                        TextField("servings", text: $servingsUnit).frame(width: 110)
                            .foregroundStyle(Theme.mutedForeground)
                    }
                }
                case .ingredients:
                Section {
                    ForEach($ingredients) { $ingredient in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(spacing: 8) {
                                TextField("Qty", text: $ingredient.amount).keyboardType(.decimalPad).frame(width: 56)
                                TextField("Unit", text: $ingredient.unit).textInputAutocapitalization(.never).frame(width: 70)
                                TextField("Ingredient", text: $ingredient.name).font(.system(size: 16, weight: .medium))
                            }
                            HStack(spacing: 8) {
                                TextField("Preparation (e.g. diced)", text: $ingredient.preparation)
                                    .font(.system(size: 14)).foregroundStyle(Theme.mutedForeground)
                                Toggle("Optional", isOn: $ingredient.optional).toggleStyle(.button).font(.system(size: 12))
                            }
                            TextField("Section (e.g. Sauce)", text: $ingredient.group)
                                .font(.system(size: 13)).foregroundStyle(Theme.brandDeep)
                        }
                        .padding(.vertical, 4)
                    }
                    .onDelete { ingredients.remove(atOffsets: $0) }
                    .onMove { ingredients.move(fromOffsets: $0, toOffset: $1) }
                    Button("Add ingredient", systemImage: "plus") {
                        ingredients.append(EditIngredient(group: ingredients.last?.group ?? ""))
                    }
                } header: {
                    Text("Ingredients")
                } footer: {
                    Text("Swipe to delete; drag the handles in Edit to reorder.")
                }
                case .method:
                Section {
                    ForEach(Array($steps.enumerated()), id: \.element.id) { index, $step in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(alignment: .top, spacing: 10) {
                                Text("\(index + 1)")
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundStyle(Theme.brandDeep)
                                    .frame(width: 24, height: 24)
                                    .background(Theme.orange50, in: Circle())
                                TextField("What to do", text: $step.instruction, axis: .vertical).lineLimit(2...8)
                            }
                            // The step's timer: minutes turn it on; cooking mode offers it as a button.
                            HStack(spacing: 8) {
                                Image(systemName: "timer")
                                    .foregroundStyle(step.minutes.isEmpty ? Theme.mutedForeground : Theme.brand)
                                Text("Timer").foregroundStyle(Theme.mutedForeground)
                                TextField("–", text: $step.minutes)
                                    .keyboardType(.numberPad)
                                    .multilineTextAlignment(.center)
                                    .frame(width: 44, height: 30)
                                    .background(Theme.muted, in: RoundedRectangle(cornerRadius: 6))
                                Text("min").foregroundStyle(Theme.mutedForeground)
                                TextField("Name, e.g. Simmer sauce", text: $step.timerLabel)
                                    .disabled(step.minutes.isEmpty)
                                    .opacity(step.minutes.isEmpty ? 0.5 : 1)
                            }
                            .font(.system(size: 14))
                            HStack {
                                TextField("Section (optional)", text: $step.group)
                                    .font(.system(size: 13)).foregroundStyle(Theme.brandDeep)
                                Spacer()
                                // Which ingredients this step uses — cooking mode's chips.
                                Menu {
                                    ForEach(ingredients.filter { !$0.name.isEmpty }) { ingredient in
                                        Button(ingredient.name, systemImage: step.uses.contains(ingredient.id) ? "checkmark" : "") {
                                            if step.uses.contains(ingredient.id) { step.uses.remove(ingredient.id) } else { step.uses.insert(ingredient.id) }
                                        }
                                    }
                                } label: {
                                    let n = step.uses.intersection(Set(ingredients.map(\.id))).count
                                    Label(n == 0 ? "Uses…" : "Uses \(n) ingredient\(n == 1 ? "" : "s")", systemImage: "carrot")
                                        .font(.system(size: 13, weight: .medium))
                                }
                                .menuActionDismissBehavior(.disabled)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .onDelete { steps.remove(atOffsets: $0) }
                    .onMove { steps.move(fromOffsets: $0, toOffset: $1) }
                    Button("Add step", systemImage: "plus") { steps.append(EditStep(group: steps.last?.group ?? "")) }
                } header: {
                    Text("Method")
                } footer: {
                    Text("Give a step minutes and cooking mode shows a timer button for it.")
                }
                }
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                Picker("Section", selection: $tab) {
                    ForEach(Tab.allCases, id: \.self) { t in
                        Text(t == .ingredients ? "Ingredients (\(ingredients.filter { !$0.name.isEmpty }.count))"
                             : t == .method ? "Method (\(steps.filter { !$0.instruction.isEmpty }.count))" : t.rawValue)
                            .tag(t)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 20)
                .padding(.vertical, 10)
                .background(.bar)
            }
            .tint(Theme.brand)
            .navigationTitle(recipeId == nil ? "New recipe" : "Edit recipe")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .primaryAction) { EditButton() }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") { Task { await save() } }
                        .fontWeight(.semibold)
                        .disabled(saving || title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .interactiveDismissDisabled(saving)
        // A page, not a small card: on iPad the editor needs the room.
        .presentationSizing(.page)
        .task { await load() }
    }

    private func numberRow(_ label: String, text: Binding<String>, suffix: String) -> some View {
        HStack {
            Text(label)
            Spacer()
            TextField("0", text: text).keyboardType(.numberPad).multilineTextAlignment(.trailing).frame(width: 60)
            Text(suffix).foregroundStyle(Theme.mutedForeground)
        }
    }

    // MARK: Loading and saving

    private func load() async {
        guard !loaded else { return }
        loaded = true
        guard let recipeId,
              let row = try? await app.store.read({ try $0.record(.recipes, id: recipeId) }),
              let recipe = Recipe(row) else { return }
        original = row
        title = recipe.title
        summary = recipe.description ?? ""
        cuisine = recipe.cuisine ?? ""
        prep = recipe.prepTimeMinutes.map(String.init) ?? ""
        cook = recipe.cookTimeMinutes.map(String.init) ?? ""
        servings = recipe.servings.flatMap { Format.amount(String($0)) } ?? ""
        servingsUnit = recipe.servingsUnit ?? "servings"
        difficulty = recipe.difficulty?.rawValue ?? ""
        role = recipe.mealRole ?? ""
        tags = recipe.tags.joined(separator: ", ")
        var rowFor: [String: UUID] = [:]
        ingredients = recipe.ingredients.map {
            let row = EditIngredient(name: $0.name, amount: Format.amount($0.amount) ?? "", unit: $0.unit ?? "",
                                     preparation: $0.preparation ?? "", group: $0.groupLabel ?? "", optional: $0.isOptional)
            rowFor[$0.id] = row.id
            return row
        }
        steps = recipe.steps.map {
            EditStep(instruction: $0.instruction, minutes: $0.durationMinutes.map(String.init) ?? "",
                     timerLabel: $0.timerLabel ?? "", group: $0.groupLabel ?? "",
                     uses: Set($0.ingredientIds.compactMap { rowFor[$0] }))
        }
        if ingredients.isEmpty { ingredients = [EditIngredient()] }
        if steps.isEmpty { steps = [EditStep()] }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let text = { (s: String) -> JSONValue in
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? .null : .string(t)
        }
        let int = { (s: String) -> JSONValue in Int(s.trimmingCharacters(in: .whitespaces)).map { .number(Double($0)) } ?? .null }
        let keep = { (key: String) -> JSONValue in original?[key] ?? .null }
        let number = { (key: String) -> JSONValue in original?.number(key).map { .number($0) } ?? .null }

        let kept = ingredients.filter { !$0.name.trimmingCharacters(in: .whitespaces).isEmpty }
        var payload: [String: JSONValue] = [
            "title": .string(title.trimmingCharacters(in: .whitespacesAndNewlines)),
            "description": text(summary),
            "cuisine": text(cuisine),
            "prepTimeMinutes": int(prep),
            "cookTimeMinutes": int(cook),
            "servings": text(servings),
            "servingsUnit": .string(servingsUnit.trimmingCharacters(in: .whitespaces).isEmpty ? "servings" : servingsUnit),
            "difficulty": difficulty.isEmpty ? .null : .string(difficulty),
            "mealRole": role.isEmpty ? .null : .string(role),
            "tags": .array(tags.split(separator: ",").map { .string($0.trimmingCharacters(in: .whitespaces)) }
                .filter { if case .string(let t) = $0 { !t.isEmpty } else { false } }),
            "ingredients": .array(kept.map {
                .object(["ingredientName": .string($0.name.trimmingCharacters(in: .whitespaces)),
                         "amount": .string($0.amount), "unit": .string($0.unit),
                         "preparation": .string($0.preparation), "isOptional": .bool($0.optional),
                         "groupLabel": .string($0.group)])
            }),
            "steps": .array(steps.filter { !$0.instruction.trimmingCharacters(in: .whitespaces).isEmpty }.map { step in
                .object(["instruction": .string(step.instruction.trimmingCharacters(in: .whitespacesAndNewlines)),
                         "durationMinutes": .string(step.minutes), "timerLabel": .string(step.timerLabel),
                         "groupLabel": .string(step.group),
                         "ingredientIndexes": .array(kept.indices.filter { step.uses.contains(kept[$0].id) }
                             .map { .number(Double($0)) })])
            }),
            // Carried over untouched.
            "imageUrl": keep("imageUrl"), "thumbnailUrl": keep("thumbnailUrl"), "notes": keep("notes"),
            "sourceUrl": keep("sourceUrl"), "mealTypes": keep("mealTypes"),
        ]
        // Any figure at all, not the source flag: older rows have numbers with
        // nutritionSource "none", and a replace without them would wipe them.
        if original.flatMap(Recipe.init)?.hasNutrition == true {
            payload["nutrition"] = .object([
                "calories": number("calories"), "proteinG": number("proteinG"), "carbsG": number("carbsG"),
                "fatG": number("fatG"), "saturatedFatG": number("saturatedFatG"), "fiberG": number("fiberG"),
                "sugarG": number("sugarG"), "sodiumMg": number("sodiumMg"),
            ])
        }

        do {
            let id = try await app.api.saveRecipe(id: recipeId, payload: .object(payload))
            app.toast = recipeId == nil ? "Recipe created." : "Recipe saved."
            await app.syncNow()
            dismiss()
            onSaved?(id)
        } catch APIError.http(_, _, let message) {
            app.toast = "Couldn’t save: \(message)"
        } catch {
            app.toast = app.online ? "Couldn’t save the recipe." : "You’re offline — editing recipes needs a connection for now."
        }
    }
}
