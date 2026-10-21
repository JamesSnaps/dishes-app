// Create or edit a recipe: the web editor's fields — title, description,
// cuisine, times, servings, difficulty, role, tags, then ingredients and steps
// in sections, each reorderable. Online: it saves through /api/v1/recipes and
// the next sync brings the server's copy.
//
// A save replaces the whole recipe, so everything this editor doesn't show
// (photo, nutrition, notes, source link, meal types) is carried over from the
// device's copy of the row rather than cleared.
//
// A draft from the on-device AI (a scanned page, ConciergeSheet) opens it as
// a new recipe filled in, marked as read by the AI, to check against the page;
// saving sends it to POST /api/v1/recipes/generated, so it's saved as the
// server's own AI recipes are (marked AI, filed in a collection when one fits).
//
// Each step remembers which ingredients it uses (the links cooking mode shows
// as chips). Ingredients get new ids on every save, so the links travel as
// positions in the ingredients list (`ingredientIndexes`) and the server maps
// them to the new ids — they survive reordering, adding and deleting.

import DishesCore
import SwiftUI
import UIKit

/// A recipe the AI read (a scanned page), for the editor to check before saving.
struct ReviewDraft: Identifiable {
    let id = UUID()
    var recipe: GeneratedRecipe
    var engine: AIEngine
}

struct RecipeEditor: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    /// nil: a new recipe.
    let recipeId: String?
    /// A new recipe read by the AI, to check before it's saved.
    var draft: ReviewDraft? = nil
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
    @State private var pasting = false

    /// Three tabs, so no one screen is a long scroll.
    enum Tab: String, CaseIterable { case details = "Details", ingredients = "Ingredients", method = "Method" }

    var body: some View {
        NavigationStack {
            Form {
                switch tab {
                case .details:
                if let draft {
                    Section {
                        Label {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(draft.engine == .device ? "Read on this \(UIDevice.current.model)" : "Read by the AI")
                                    .font(.system(size: 15, weight: .semibold))
                                Text("Check it against the page, then save.")
                                    .font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                            }
                        } icon: {
                            Image(systemName: draft.engine == .device ? "apple.intelligence" : "sparkles").foregroundStyle(Theme.brand)
                        }
                    }
                    .listRowBackground(Theme.orange50)
                }
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
                    Button("Paste ingredients and method…", systemImage: "doc.on.clipboard") { pasting = true }
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
                    Button("Paste ingredients and method…", systemImage: "doc.on.clipboard") { pasting = true }
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
            .navigationTitle(draft != nil ? "Check the recipe" : recipeId == nil ? "New recipe" : "Edit recipe")
            .navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $pasting) {
                PasteImportSheet { parsed in
                    let blank = ingredients.allSatisfy { $0.name.isEmpty }
                    let newIngredients = parsed.ingredients.map {
                        EditIngredient(name: $0.ingredientName, amount: $0.amount, unit: $0.unit,
                                       preparation: $0.preparation, group: $0.groupLabel, optional: $0.isOptional)
                    }
                    ingredients = (blank ? [] : ingredients) + newIngredients
                    let blankSteps = steps.allSatisfy { $0.instruction.isEmpty }
                    steps = (blankSteps ? [] : steps) + parsed.steps.map {
                        EditStep(instruction: $0.instruction, minutes: $0.durationMinutes, timerLabel: $0.timerLabel, group: $0.groupLabel)
                    }
                    if ingredients.isEmpty { ingredients = [EditIngredient()] }
                    if steps.isEmpty { steps = [EditStep()] }
                    tab = parsed.ingredients.isEmpty ? .method : .ingredients
                }
            }
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
        if let draft {
            fill(from: draft.recipe)
            return
        }
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

    private func fill(from recipe: GeneratedRecipe) {
        title = recipe.title
        summary = recipe.description
        cuisine = recipe.cuisine
        prep = recipe.prepTimeMinutes.map(String.init) ?? ""
        cook = recipe.cookTimeMinutes.map(String.init) ?? ""
        servings = recipe.servings
        servingsUnit = recipe.servingsUnit
        difficulty = recipe.difficulty
        role = recipe.mealRole ?? ""
        tags = recipe.tags.joined(separator: ", ")
        ingredients = recipe.ingredients.map {
            EditIngredient(name: $0.ingredientName, amount: $0.amount, unit: $0.unit, preparation: $0.preparation,
                           group: $0.groupLabel, optional: $0.isOptional)
        }
        steps = recipe.steps.map {
            EditStep(instruction: $0.instruction, minutes: $0.durationMinutes, timerLabel: $0.timerLabel, group: $0.groupLabel)
        }
        if ingredients.isEmpty { ingredients = [EditIngredient()] }
        if steps.isEmpty { steps = [EditStep()] }
    }

    /// The draft as edited, in the shape POST /api/v1/recipes/generated takes.
    private func edited(_ draft: ReviewDraft) -> GeneratedRecipe {
        let trim = { (s: String) in s.trimmingCharacters(in: .whitespacesAndNewlines) }
        var recipe = draft.recipe
        recipe.title = trim(title)
        recipe.description = trim(summary)
        recipe.cuisine = trim(cuisine)
        recipe.prepTimeMinutes = Int(trim(prep))
        recipe.cookTimeMinutes = Int(trim(cook))
        recipe.servings = trim(servings).isEmpty ? "4" : trim(servings)
        recipe.servingsUnit = trim(servingsUnit).isEmpty ? "servings" : trim(servingsUnit)
        recipe.difficulty = difficulty.isEmpty ? "medium" : difficulty
        recipe.mealRole = role.isEmpty ? nil : role
        recipe.tags = tags.split(separator: ",").map { trim(String($0)) }.filter { !$0.isEmpty }
        recipe.ingredients = ingredients.filter { !trim($0.name).isEmpty }.map {
            .init(ingredientName: trim($0.name), amount: trim($0.amount), unit: trim($0.unit),
                  preparation: trim($0.preparation), isOptional: $0.optional, groupLabel: trim($0.group))
        }
        recipe.steps = steps.filter { !trim($0.instruction).isEmpty }.map {
            .init(instruction: trim($0.instruction), durationMinutes: Int(trim($0.minutes)).map(String.init) ?? "",
                  timerLabel: trim($0.timerLabel), groupLabel: trim($0.group))
        }
        return recipe
    }

    private func save() async {
        saving = true
        defer { saving = false }
        if let draft {
            do {
                var recipe = edited(draft)
                // The collection, chosen on the device from the cached names when it can
                // (the server then skips its own AI call); otherwise left to the server.
                let filing = try? await AIRouter.run(
                    .fileRecipe,
                    onDevice: { () throws -> String?? in
                        guard #available(iOS 27, *), let collections = AIContext.cached?.collections, !collections.isEmpty else {
                            throw CancellationError()
                        }
                        return .some(try await CollectionPicker.pick(for: recipe, from: collections)?.id)
                    },
                    fallback: { String??.none })
                recipe.collectionId = filing?.value ?? .none
                let made = try await app.api.saveGeneratedRecipe(recipe)
                app.toast = made.collectionName.map { "Saved \(made.title) to \($0)." } ?? "Saved \(made.title)."
                await app.syncNow()
                dismiss()
                onSaved?(made.recipeId)
            } catch APIError.http(_, _, let message) {
                app.toast = "Couldn’t save: \(message)"
            } catch {
                app.toast = app.online ? "Couldn’t save the recipe." : "You’re offline — saving it needs a connection. It stays here until then."
            }
            return
        }
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

/// The web's paste import: paste the ingredient list and the method as text
/// (from a website, a message, notes) and they're parsed into rows — on the
/// device, offline: the server's rules (MethodRules, IngredientRules), with
/// the on-device model tidying the ingredient lines they misread
/// (IngredientLineReader).
struct PasteImportSheet: View {
    struct Parsed: Decodable, Sendable {
        struct Ingredient: Decodable, Sendable { var ingredientName: String; var amount: String; var unit: String; var preparation: String; var isOptional: Bool; var groupLabel: String }
        struct Step: Decodable, Sendable { var instruction: String; var durationMinutes: String; var timerLabel: String; var groupLabel: String }
        var ingredients: [Ingredient]
        var steps: [Step]
    }
    @Environment(\.dismiss) private var dismiss
    var imported: (Parsed) -> Void

    /// As the server's `import.parse`: method-looking lines in the ingredients
    /// box move to the method when the method box is empty.
    static func parse(_ ingredientText: String, _ methodText: String) async -> Parsed {
        let split = MethodRules.splitIngredients(ingredientText)
        let rows = await IngredientLineReader.read(split.lines)
        let method = methodText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? split.leftover : methodText
        return Parsed(
            ingredients: rows.map { row in
                let i = row.value
                return .init(ingredientName: i.ingredientName, amount: i.amount, unit: i.unit, preparation: i.preparation,
                             isOptional: i.isOptional, groupLabel: i.groupLabel)
            },
            steps: MethodRules.steps(method).map {
                .init(instruction: $0.instruction, durationMinutes: $0.durationMinutes, timerLabel: $0.timerLabel, groupLabel: $0.groupLabel)
            })
    }
    @State private var ingredientText = ""
    @State private var methodText = ""
    @State private var working = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("2 onions, finely chopped\n400 g tin chopped tomatoes\n…", text: $ingredientText, axis: .vertical).lineLimit(6...14)
                } header: { Text("Ingredients") } footer: { Text("One per line. Amounts, units and preparation are picked out.") }
                Section {
                    TextField("Fry the onions until soft…\nAdd the tomatoes and simmer for 20 minutes.", text: $methodText, axis: .vertical).lineLimit(6...14)
                } header: { Text("Method") } footer: { Text("Steps are split by line or number; times become timers.") }
                if UIPasteboard.general.hasStrings {
                    Button("Paste everything into Ingredients", systemImage: "doc.on.clipboard") {
                        ingredientText = UIPasteboard.general.string ?? ""
                    }
                }
            }
            .navigationTitle("Paste a recipe").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(working ? "Reading…" : "Add") {
                        Task {
                            working = true; defer { working = false }
                            let parsed = await Self.parse(ingredientText, methodText)
                            if parsed.ingredients.isEmpty && parsed.steps.isEmpty {
                                AppModel.shared.toast = "Nothing recognisable there."
                            } else {
                                imported(parsed)
                                dismiss()
                            }
                        }
                    }
                    .bold()
                    .disabled(working || (ingredientText.isEmpty && methodText.isEmpty))
                }
            }
        }
    }
}
