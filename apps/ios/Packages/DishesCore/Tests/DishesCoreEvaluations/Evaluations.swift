// The on-device AI's evaluations (TODO_MOBILE.md, Phase D2): a fixed set per
// job, scored against expected answers, deciding whether the job may start on
// the device (Gate). Each run leaves its record in fixtures/evals/results/.
// Re-run after each iOS point release.
//
//   cd apps/ios/Packages/DishesCore
//   DISHES_EVALS=1 swift test --filter DishesCoreEvaluations
//
// macOS 27 with Apple Intelligence on: the Mac runs the same on-device model
// as the iPad (check `DeviceAI.modelDescription` matches the devices').

import CoreGraphics
import Evaluations
import ImageIO
import Foundation
import Testing
@testable import DishesCore

enum IngredientEval {
    struct Parts: Codable, Sendable, Hashable {
        var amount: String
        var unit: String
        var name: String
        var preparation: String
    }
}

/// What each sample did, beside the framework's metrics: the gate and the record need it.
actor Recorder {
    var samples: [EvalRecord.Sample] = []
    func add(_ s: EvalRecord.Sample) { samples.append(s) }
}

// MARK: Ingredient lines

@available(macOS 27, iOS 27, *)
struct IngredientLineEvaluation: Evaluation {
    let fixtures: [String: IngredientLineFixture]
    let recorder: Recorder
    let score = Metric("score")
    let structure = Metric("structure")

    var dataset: ArrayLoader<ModelSample<IngredientEval.Parts>> {
        ArrayLoader(samples: fixtures.values.sorted { $0.line < $1.line }.map {
            ModelSample(prompt: $0.line, expected: IngredientEval.Parts(amount: $0.expected.amount, unit: $0.expected.unit,
                                                                         name: $0.expected.name, preparation: $0.expected.preparation))
        })
    }

    func subject(from sample: ModelSample<IngredientEval.Parts>) async throws -> ModelSubject<IngredientEval.Parts> {
        let line = sample.promptDescription
        let start = Date()
        let run = await IngredientLineReader.read(line)
        let got = run?.value ?? GeneratedRecipe.Ingredient(ingredientName: "")
        let expected = sample.expected!
        let rules = IngredientRules.parse(line) ?? GeneratedRecipe.Ingredient(ingredientName: "")
        await recorder.add(.init(name: line, deviceScore: Score.line(got, expected), serverScore: Score.line(rules, expected),
                                 engine: run?.engine.rawValue ?? "none",
                                 problems: run?.engine == .device ? IngredientChecks.problems(got, line: line) : [],
                                 seconds: Date().timeIntervalSince(start)))
        return ModelSubject(value: IngredientEval.Parts(amount: got.amount, unit: got.unit, name: got.ingredientName,
                                                        preparation: got.preparation))
    }

    var evaluators: Evaluators {
        Evaluator<ModelSample<IngredientEval.Parts>> { sample, subject in
            let got = GeneratedRecipe.Ingredient(ingredientName: subject.value.name, amount: subject.value.amount,
                                                 unit: subject.value.unit, preparation: subject.value.preparation)
            return score.scoring(Score.line(got, sample.expected!))
        }
    }

    func aggregateMetrics(using aggregator: inout MetricsAggregator) {
        aggregator.computeMean(of: score)
    }
}

// MARK: Recipe cards

@available(macOS 27, iOS 27, *)
struct RecipeScanEvaluation: Evaluation {
    struct Card: Sendable {
        var name: String
        var image: CGImage
        var expected: GeneratedRecipe
    }

    let cards: [String: Card]
    let context: AIContext
    let recorder: Recorder
    let score = Metric("score")

    var dataset: ArrayLoader<ModelSample<GeneratedRecipe>> {
        ArrayLoader(samples: cards.keys.sorted().filter(evalOnly).map { ModelSample(prompt: $0, expected: cards[$0]!.expected) })
    }

    func subject(from sample: ModelSample<GeneratedRecipe>) async throws -> ModelSubject<GeneratedRecipe> {
        let card = cards[sample.promptDescription]!
        let start = Date()
        var problems: [String]
        var got = GeneratedRecipe(title: "", ingredients: [], steps: [])
        do {
            let reading = try await RecipeReader.read([card.image], context: context)
            got = reading.recipe
            problems = RecipeChecks.problems(got, metric: context.measurementSystem == "metric", pageText: reading.pageText)
            if !problems.isEmpty { printRecipe(card.name, got, pageText: reading.pageText) }
        } catch {
            problems = [DeviceAI.describe(error)]
        }
        await recorder.add(.init(name: card.name, deviceScore: Score.recipe(got, card.expected), serverScore: nil,
                                 engine: "device", problems: problems, seconds: Date().timeIntervalSince(start)))
        return ModelSubject(value: got)
    }

    var evaluators: Evaluators {
        Evaluator<ModelSample<GeneratedRecipe>> { sample, subject in
            score.scoring(Score.recipe(subject.value, sample.expected!))
        }
    }

    func aggregateMetrics(using aggregator: inout MetricsAggregator) {
        aggregator.computeMean(of: score)
    }

    /// The seed recipes in the twenty printed styles, then any real photos
    /// in fixtures/evals/recipe-photos (<name>.jpg + <name>.json).
    static func cards() throws -> [String: Card] {
        struct File: Decodable { var recipes: [GeneratedRecipe] }
        let recipes = try JSONDecoder().decode(File.self, from: Data(contentsOf: fixtureURL("evals/recipe-cards.json"))).recipes
        var out: [String: Card] = [:]
        for (n, style) in CardStyle.all.enumerated() {
            let recipe = recipes[n % recipes.count]
            let name = String(format: "%02d %@ (%@)", n + 1, recipe.title, style.description)
            out[name] = Card(name: name, image: RecipeCardRenderer.render(recipe, style: style), expected: recipe)
        }
        let photos = fixtureURL("evals/recipe-photos")
        for json in (try? FileManager.default.contentsOfDirectory(at: photos, includingPropertiesForKeys: nil)) ?? []
        where json.pathExtension == "json" {
            let jpg = json.deletingPathExtension().appendingPathExtension("jpg")
            guard let source = CGImageSourceCreateWithURL(jpg as CFURL, nil),
                  let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { continue }
            let name = "photo " + json.deletingPathExtension().lastPathComponent
            out[name] = Card(name: name, image: image, expected: try JSONDecoder().decode(GeneratedRecipe.self, from: Data(contentsOf: json)))
        }
        return out
    }
}

// MARK: Text

@available(macOS 27, iOS 27, *)
struct RecipeTextEvaluation: Evaluation {
    struct Item: Sendable { var name: String; var text: String; var expected: GeneratedRecipe }
    let items: [String: Item]
    let context: AIContext
    let recorder: Recorder
    let score = Metric("score")

    var dataset: ArrayLoader<ModelSample<GeneratedRecipe>> {
        ArrayLoader(samples: items.keys.sorted().map { ModelSample(prompt: $0, expected: items[$0]!.expected) })
    }

    func subject(from sample: ModelSample<GeneratedRecipe>) async throws -> ModelSubject<GeneratedRecipe> {
        let s = items[sample.promptDescription]!
        let start = Date()
        var problems: [String]
        var got = GeneratedRecipe(title: "", ingredients: [], steps: [])
        do {
            let reading = try await RecipeReader.read(text: s.text, context: context)
            got = reading.recipe
            problems = RecipeChecks.problems(got, metric: true, pageText: reading.pageText)
        } catch {
            problems = [DeviceAI.describe(error)]
        }
        await recorder.add(.init(name: s.name, deviceScore: Score.recipe(got, s.expected), serverScore: nil,
                                 engine: "device", problems: problems, seconds: Date().timeIntervalSince(start)))
        return ModelSubject(value: got)
    }

    var evaluators: Evaluators {
        Evaluator<ModelSample<GeneratedRecipe>> { sample, subject in score.scoring(Score.recipe(subject.value, sample.expected!)) }
    }

    func aggregateMetrics(using aggregator: inout MetricsAggregator) { aggregator.computeMean(of: score) }

    /// The seed recipes, each written in the next of the four styles: twenty samples.
    static func items() throws -> [String: Item] {
        struct File: Decodable { var recipes: [GeneratedRecipe] }
        let recipes = try JSONDecoder().decode(File.self, from: Data(contentsOf: fixtureURL("evals/recipe-cards.json"))).recipes
        var out: [String: Item] = [:]
        for n in 0..<20 {
            let recipe = recipes[n % recipes.count]
            let style = TextStyle.allCases[n % TextStyle.allCases.count]
            let name = String(format: "%02d %@ (%@)", n + 1, recipe.title, style.rawValue)
            out[name] = Item(name: name, text: RecipeTextRenderer.render(recipe, style: style), expected: recipe)
        }
        return out
    }
}

// MARK: Filing a recipe

struct CollectionsFixture: Decodable, Sendable {
    struct Recipe: Decodable, Sendable {
        var title: String
        var description: String
        var cuisine: String
        var tags: [String]
        var mealTypes: [String]
        var acceptable: [String]
    }
    var collections: [AIContext.Collection]
    var recipes: [Recipe]

    static func load() throws -> CollectionsFixture {
        try JSONDecoder().decode(CollectionsFixture.self, from: Data(contentsOf: fixtureURL("evals/collections.json")))
    }

    /// 1 for an acceptable collection; 0.5 for none when one fitted (a cautious
    /// miss beats a wrong filing, as the server's prompt says); 0 otherwise.
    static func score(_ picked: String?, acceptable: [String]) -> Double {
        switch (picked, acceptable.isEmpty) {
        case (nil, true): 1
        case (nil, false): 0.5
        case (let name?, _): acceptable.contains(name) ? 1 : 0
        }
    }
}

@available(macOS 27, iOS 27, *)
struct FileRecipeEvaluation: Evaluation {
    let fixture: CollectionsFixture
    let recorder: Recorder
    let score = Metric("score")

    var dataset: ArrayLoader<ModelSample<String>> {
        ArrayLoader(samples: fixture.recipes.map { ModelSample(prompt: $0.title, expected: $0.acceptable.joined(separator: " | ")) })
    }

    func subject(from sample: ModelSample<String>) async throws -> ModelSubject<String> {
        let r = fixture.recipes.first { $0.title == sample.promptDescription }!
        let start = Date()
        let recipe = GeneratedRecipe(title: r.title, description: r.description, cuisine: r.cuisine, mealTypes: r.mealTypes,
                                     tags: r.tags, ingredients: [], steps: [])
        var picked: String?
        var problems: [String] = []
        do { picked = try await CollectionPicker.pick(for: recipe, from: fixture.collections)?.name } catch { problems = [DeviceAI.describe(error)] }
        await recorder.add(.init(name: "\(r.title) → \(picked ?? "none") (\(r.acceptable.isEmpty ? "none" : r.acceptable.joined(separator: "/")))",
                                 deviceScore: CollectionsFixture.score(picked, acceptable: r.acceptable), serverScore: nil,
                                 engine: "device", problems: problems, seconds: Date().timeIntervalSince(start)))
        return ModelSubject(value: picked ?? "")
    }

    var evaluators: Evaluators {
        Evaluator<ModelSample<String>> { sample, subject in
            let acceptable = (sample.expected ?? "").split(separator: " | ").map(String.init)
            return score.scoring(CollectionsFixture.score(subject.value.isEmpty ? nil : subject.value, acceptable: acceptable))
        }
    }

    func aggregateMetrics(using aggregator: inout MetricsAggregator) { aggregator.computeMean(of: score) }
}

// MARK: Cook assist

struct CookAssistFixture: Decodable, Sendable {
    struct Question: Decodable, Sendable {
        var recipe: String
        var step: Int
        var question: String
        var earlier: [APIClient.AssistMessage]?
        var mention: [[String]]
        var avoid: [String]
        var name: String { "\(recipe) \(step): \(question)" }
    }
    var questions: [Question]

    static func load() throws -> CookAssistFixture {
        try JSONDecoder().decode(CookAssistFixture.self, from: Data(contentsOf: fixtureURL("evals/cook-assist.json")))
    }

    /// The context cooking mode sends, built from the seed recipe.
    static func context(_ q: Question, recipes: [GeneratedRecipe]) -> APIClient.CookAssistContext {
        let r = recipes.first { $0.title == q.recipe }!
        let item = { (i: GeneratedRecipe.Ingredient) in
            APIClient.CookAssistContext.Ingredient(amount: i.amount.isEmpty ? nil : i.amount, unit: i.unit, name: i.ingredientName)
        }
        let instruction = r.steps[q.step - 1].instruction
        // The seed has no step → ingredient links; the step's words stand in.
        let used = r.ingredients.filter { i in
            i.ingredientName.lowercased().split(separator: " ").contains { $0.count > 3 && instruction.lowercased().contains($0) }
        }
        return .init(recipeTitle: r.title, stepNumber: q.step, stepInstruction: instruction, stepIngredients: used.map(item),
                     allIngredients: r.ingredients.map(item),
                     allSteps: r.steps.enumerated().map { .init(number: $0.offset + 1, instruction: $0.element.instruction) },
                     servingsSummary: nil,
                     messages: (q.earlier ?? []) + [.init(role: "user", content: q.question)])
    }

    /// The share of `mention` covered; 0 if it says something to avoid.
    static func score(_ answer: String, _ q: Question) -> Double {
        let text = answer.lowercased()
        if q.avoid.contains(where: { text.contains($0.lowercased()) }) { return 0 }
        guard !q.mention.isEmpty else { return 1 }
        let covered = q.mention.filter { any in any.contains { text.contains($0.lowercased()) } }.count
        return Double(covered) / Double(q.mention.count)
    }
}

@available(macOS 27, iOS 27, *)
struct CookAssistEvaluation: Evaluation {
    let fixture: CookAssistFixture
    let recipes: [GeneratedRecipe]
    let recorder: Recorder
    let score = Metric("score")

    /// Substitutions go to the household's AI (CookAssist.isSubstitution), so aren't the device's to pass.
    var dataset: ArrayLoader<ModelSample<String>> {
        ArrayLoader(samples: fixture.questions.filter { !CookAssist.isSubstitution($0.question) }.map { ModelSample(prompt: $0.name, expected: "") })
    }

    func subject(from sample: ModelSample<String>) async throws -> ModelSubject<String> {
        let q = fixture.questions.first { $0.name == sample.promptDescription }!
        let start = Date()
        var answer = ""
        var problems: [String]
        do {
            for try await chunk in CookAssist.onDevice(CookAssistFixture.context(q, recipes: recipes)) { answer += chunk }
            problems = CookAssistChecks.problems(answer)
        } catch {
            problems = [DeviceAI.describe(error)]
        }
        let oneLine = answer.replacingOccurrences(of: "\n", with: " ")
        await recorder.add(.init(name: "\(q.name) → \(oneLine)", deviceScore: CookAssistFixture.score(answer, q),
                                 serverScore: nil, engine: "device", problems: problems, seconds: Date().timeIntervalSince(start)))
        return ModelSubject(value: answer)
    }

    var evaluators: Evaluators {
        Evaluator<ModelSample<String>> { sample, subject in
            let q = fixture.questions.first { $0.name == sample.promptDescription }!
            return score.scoring(CookAssistFixture.score(subject.value, q))
        }
    }

    func aggregateMetrics(using aggregator: inout MetricsAggregator) { aggregator.computeMean(of: score) }
}

// MARK: Recipe tweaks

struct TweaksFixture: Decodable, Sendable {
    struct Tweak: Decodable, Sendable {
        var recipe: String
        var instruction: String
        var absent: [String]
        var present: [[String]]
        var servings: String?
        var name: String { "\(recipe): \(instruction)" }
    }
    var tweaks: [Tweak]

    static func load() throws -> TweaksFixture {
        try JSONDecoder().decode(TweaksFixture.self, from: Data(contentsOf: fixtureURL("evals/tweaks.json")))
    }

    /// The mean of: each `absent` gone, each `present` there, the servings,
    /// and the share of untouched ingredients kept.
    static func score(_ got: GeneratedRecipe, original: GeneratedRecipe, _ t: Tweak) -> Double {
        let text = (got.ingredients.map { "\($0.amount)\($0.unit) \($0.ingredientName) \($0.preparation)" }
                    + got.steps.map(\.instruction)).joined(separator: "\n").lowercased()
        var parts = t.absent.map { text.contains($0.lowercased()) ? 0.0 : 1 }
        parts += t.present.map { any in any.contains { text.contains($0.lowercased()) } ? 1 : 0 }
        if let servings = t.servings { parts.append(got.servings == servings ? 1 : 0) }
        let untouched = original.ingredients.filter { i in !t.absent.contains { i.ingredientName.lowercased().contains($0.lowercased()) } }
        let kept = untouched.filter { i in got.ingredients.contains { Score.overlap($0.ingredientName, i.ingredientName) >= 0.5 } }.count
        parts.append(untouched.isEmpty ? 1 : Double(kept) / Double(untouched.count))
        return parts.reduce(0, +) / Double(parts.count)
    }
}

@available(macOS 27, iOS 27, *)
struct TweakEvaluation: Evaluation {
    let fixture: TweaksFixture
    let recipes: [GeneratedRecipe]
    let recorder: Recorder
    let score = Metric("score")

    var dataset: ArrayLoader<ModelSample<String>> {
        ArrayLoader(samples: fixture.tweaks.map { ModelSample(prompt: $0.name, expected: "") })
    }

    func subject(from sample: ModelSample<String>) async throws -> ModelSubject<String> {
        let t = fixture.tweaks.first { $0.name == sample.promptDescription }!
        let original = recipes.first { $0.title == t.recipe }!
        let start = Date()
        var got = original
        var summary = ""
        var problems: [String]
        do {
            let tweak = try await RecipeTweaker.improve(original, instruction: t.instruction, context: nil)
            (got, summary) = (tweak.recipe, tweak.summary)
            problems = TweakChecks.problems(tweak, original: original, metric: true)
        } catch {
            problems = [DeviceAI.describe(error)]
        }
        let s = TweaksFixture.score(got, original: original, t)
        if s < 0.75 || !problems.isEmpty {
            print("[eval] ── \(t.name): " + got.ingredients.map { "\($0.amount)\($0.unit) \($0.ingredientName)" }.joined(separator: " · "))
            for step in got.steps { print("[eval]    \(step.instruction.prefix(160))") }
        }
        await recorder.add(.init(name: "\(t.name) → \(summary)", deviceScore: s, serverScore: nil, engine: "device",
                                 problems: problems, seconds: Date().timeIntervalSince(start)))
        return ModelSubject(value: String(s))
    }

    var evaluators: Evaluators {
        Evaluator<ModelSample<String>> { _, subject in score.scoring(Double(subject.value) ?? 0) }
    }

    func aggregateMetrics(using aggregator: inout MetricsAggregator) { aggregator.computeMean(of: score) }
}

// MARK: Recipe ideas

struct ConceptsFixture: Decodable, Sendable {
    struct Request: Decodable, Sendable {
        var prompt: String
        var mealType: String?
        var heartHealthy: Bool?
        var eating: [String]?
        var each: [String]
        var avoid: [String]
        var name: String { prompt + ((eating ?? []).isEmpty ? "" : " (for \((eating ?? []).joined(separator: ", ")))") }
    }
    var members: [AIContext.Member]
    var requests: [Request]

    static func load() throws -> ConceptsFixture {
        try JSONDecoder().decode(ConceptsFixture.self, from: Data(contentsOf: fixtureURL("evals/concepts.json")))
    }

    /// The share of ideas on topic and the share clean, averaged.
    static func score(_ ideas: [APIClient.Concept], _ r: Request) -> Double {
        guard !ideas.isEmpty else { return 0 }
        let text = { (c: APIClient.Concept) in "\(c.title) \(c.description) \(c.tags.joined(separator: " "))" }
        var parts: [Double] = []
        if !r.each.isEmpty {
            parts.append(Double(ideas.filter { c in r.each.contains { ConceptChecks.mentions(text(c), $0) } }.count) / Double(ideas.count))
        }
        if !r.avoid.isEmpty {
            parts.append(Double(ideas.filter { c in !r.avoid.contains { ConceptChecks.mentions(text(c), $0) } }.count) / Double(ideas.count))
        }
        return parts.isEmpty ? 1 : parts.reduce(0, +) / Double(parts.count)
    }
}

@available(macOS 27, iOS 27, *)
struct ConceptEvaluation: Evaluation {
    let fixture: ConceptsFixture
    let recorder: Recorder
    let score = Metric("score")

    var dataset: ArrayLoader<ModelSample<String>> {
        ArrayLoader(samples: fixture.requests.map(\.name).filter(evalOnly).map { ModelSample(prompt: $0, expected: "") })
    }

    func subject(from sample: ModelSample<String>) async throws -> ModelSubject<String> {
        let r = fixture.requests.first { $0.name == sample.promptDescription }!
        let context = AIContext(configured: true, measurementSystem: "metric", defaultPrompt: nil, kitchenEquipment: nil,
                                webGrounding: false, members: fixture.members, tasteProfile: nil, collections: [])
        let eating = fixture.members.filter { (r.eating ?? []).contains($0.id) }
        let start = Date()
        var ideas: [APIClient.Concept] = []
        var problems: [String]
        do {
            ideas = try await ConceptWriter.ideas(.init(prompt: r.prompt, memberIds: r.eating ?? [], mealType: r.mealType,
                                                        heartHealthy: r.heartHealthy ?? false), context: context, year: 2026)
            problems = ConceptChecks.problems(ideas, eating: eating)
        } catch {
            problems = [DeviceAI.describe(error)]
        }
        let s = ConceptsFixture.score(ideas, r)
        await recorder.add(.init(name: "\(r.name) → \(ideas.map(\.title).joined(separator: " · "))", deviceScore: s, serverScore: nil,
                                 engine: "device", problems: problems, seconds: Date().timeIntervalSince(start)))
        return ModelSubject(value: String(s))
    }

    var evaluators: Evaluators {
        Evaluator<ModelSample<String>> { _, subject in score.scoring(Double(subject.value) ?? 0) }
    }

    func aggregateMetrics(using aggregator: inout MetricsAggregator) { aggregator.computeMean(of: score) }
}

// MARK: Meal plans

struct MealPlansFixture: Decodable, Sendable {
    struct Scenario: Decodable, Sendable {
        var name: String
        struct Slot: Decodable, Sendable { var day: Int; var meal: String }
        var slots: [Slot]
        var preferences: String?
        var eating: [String]?
        var favouritesOnly: Bool?
        var heartHealthy: Bool?
        var libraryShare: Double?
        var vegetarian: Bool?
        var avoid: [String]?
        var each: [String]?
        var slotMentions: [String: [String]]?
    }
    var today: String
    var weekStartDate: String
    var recipes: [JSONValue]
    var cooks: [JSONValue]
    var plans: [JSONValue]
    var entries: [JSONValue]
    var members: [AIContext.Member]
    var scenarios: [Scenario]

    static func load() throws -> MealPlansFixture {
        try JSONDecoder().decode(MealPlansFixture.self, from: Data(contentsOf: fixtureURL("evals/meal-plans.json")))
    }

    var household: MealPlanDrafter.Household {
        .init(recipes: recipes.compactMap(Recipe.init), plans: plans.compactMap(MealPlan.init),
              entries: entries.compactMap(MealPlanEntry.init), cooks: cooks.compactMap(CookEntry.init))
    }

    func ask(_ s: Scenario) -> MealPlanDrafter.Ask {
        .init(weekStartDate: weekStartDate,
              slots: s.slots.map { .init(dayOfWeek: $0.day, mealType: $0.meal) },
              preferences: s.preferences ?? "", memberIds: s.eating ?? [], favouritesOnly: s.favouritesOnly ?? false,
              heartHealthy: s.heartHealthy ?? false)
    }

    /// The mean of the scenario's parts, each 0…1.
    func score(_ slots: [APIClient.PlanSlot], _ s: Scenario, library: MealPlanDrafter.Library) -> Double {
        guard !slots.isEmpty else { return 0 }
        let byId = Dictionary(household.recipes.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let text = { (p: APIClient.PlanSlot) -> String in
            let r = p.recipeId.flatMap { byId[$0] }
            return "\(p.title) \(p.description) " + (r.map { "\($0.tags.joined(separator: " ")) \($0.ingredients.map(\.name).joined(separator: " "))" } ?? "")
        }
        let share = { (ok: (APIClient.PlanSlot) -> Bool) in Double(slots.filter(ok).count) / Double(slots.count) }
        var parts: [Double] = [Set(slots.map { $0.title.lowercased() }).count == slots.count ? 1 : 0]
        let avoid = Set((library.recent + library.disliked).map { $0.lowercased() })
        parts.append(share { !avoid.contains($0.title.lowercased()) })
        if let want = s.libraryShare { parts.append(min(1, share { $0.recipeId != nil } / want)) }
        if s.vegetarian == true {
            parts.append(share { p in
                if let r = p.recipeId.flatMap({ byId[$0] }) { return r.tags.contains("vegetarian") }
                return !ConceptChecks.meat.contains { ConceptChecks.mentions(text(p), $0) }
            })
        }
        if let avoid = s.avoid { parts.append(share { p in !avoid.contains { ConceptChecks.mentions(text(p), $0) } }) }
        if let each = s.each { parts.append(share { p in each.contains { ConceptChecks.mentions(text(p), $0) } }) }
        for (day, words) in s.slotMentions ?? [:] {
            let slot = slots.first { String($0.dayOfWeek) == day }
            parts.append(slot.map { p in words.contains { ConceptChecks.mentions(text(p), $0) } } == true ? 1 : 0)
        }
        return parts.reduce(0, +) / Double(parts.count)
    }
}

@available(macOS 27, iOS 27, *)
struct MealPlanEvaluation: Evaluation {
    let fixture: MealPlansFixture
    let recorder: Recorder
    let score = Metric("score")

    var dataset: ArrayLoader<ModelSample<String>> {
        ArrayLoader(samples: fixture.scenarios.map(\.name).filter(evalOnly).map { ModelSample(prompt: $0, expected: "") })
    }

    func subject(from sample: ModelSample<String>) async throws -> ModelSubject<String> {
        let s = fixture.scenarios.first { $0.name == sample.promptDescription }!
        let context = AIContext(configured: true, measurementSystem: "metric", defaultPrompt: nil, kitchenEquipment: nil,
                                webGrounding: false, members: fixture.members, tasteProfile: nil, collections: [])
        let today = MealPlanDrafter.date(fixture.today)!.addingTimeInterval(12 * 3600)
        let ask = fixture.ask(s)
        let eating = fixture.members.filter { (s.eating ?? []).contains($0.id) }
        let library = MealPlanDrafter.library(ask, household: fixture.household, eating: eating.map(\.displayName), today: today,
                                              diets: eating.flatMap(\.dietaryFlags))
        let start = Date()
        var slots: [APIClient.PlanSlot] = []
        var problems: [String]
        do {
            slots = try await MealPlanDrafter.draft(ask, household: fixture.household, context: context, today: today)
            problems = PlanChecks.problems(slots, ask: ask, library: library, eating: eating)
        } catch {
            problems = [DeviceAI.describe(error)]
        }
        let value = fixture.score(slots, s, library: library)
        let shown = slots.map { "\($0.title)\($0.recipeId == nil ? " (new)" : "")" }.joined(separator: " · ")
        await recorder.add(.init(name: "\(s.name) → \(shown)", deviceScore: value, serverScore: nil, engine: "device",
                                 problems: problems, seconds: Date().timeIntervalSince(start)))
        return ModelSubject(value: String(value))
    }

    var evaluators: Evaluators {
        Evaluator<ModelSample<String>> { _, subject in score.scoring(Double(subject.value) ?? 0) }
    }

    func aggregateMetrics(using aggregator: inout MetricsAggregator) { aggregator.computeMean(of: score) }
}

// MARK: Running them

/// DISHES_EVAL_ONLY=<text>: only the samples whose name contains it, to look at one.
func evalOnly(_ name: String) -> Bool {
    guard let only = ProcessInfo.processInfo.environment["DISHES_EVAL_ONLY"], !only.isEmpty else { return true }
    return name.localizedCaseInsensitiveContains(only)
}

/// What the model made of a sample that failed its checks, to see why.
func printRecipe(_ name: String, _ r: GeneratedRecipe, pageText: String) {
    print("[eval] ── \(name): “\(r.title)”, serves \(r.servings)")
    for i in r.ingredients { print("[eval]    · [\(i.amount)] [\(i.unit)] [\(i.ingredientName)] [\(i.preparation)]") }
    print("[eval]    page: " + pageText.replacingOccurrences(of: "\n", with: " ⏎ ").prefix(600))
}

@Suite(.serialized, .enabled(if: evaluationsWanted, "DISHES_EVALS=1 to run the on-device AI's evaluations"))
struct AIEvaluations {
    @available(macOS 27, iOS 27, *)
    func record(_ job: AITask, _ recorder: Recorder, serverIs: String) async throws -> Gate {
        let samples = await recorder.samples.sorted { $0.name < $1.name }
        let structure = samples.filter(\.problems.isEmpty).count
        let device = samples.map(\.deviceScore).reduce(0, +) / Double(max(samples.count, 1))
        let servers = samples.compactMap(\.serverScore)
        let server = servers.count == samples.count && !samples.isEmpty ? servers.reduce(0, +) / Double(servers.count) : nil
        let gate = Gate(structurePassed: structure, samples: samples.count, deviceScore: device, serverScore: server)
        // A run of a few samples (DISHES_EVAL_ONLY) isn't the job's record.
        if ProcessInfo.processInfo.environment["DISHES_EVAL_ONLY"] == nil {
            try EvalRecord(job: job.rawValue, date: Date(), model: DeviceAI.modelDescription ?? "unavailable", samples: samples.count,
                       structurePassed: structure, deviceScore: device, serverScore: server, serverIs: serverIs,
                       passes: gate.passes, perSample: samples).save()
        }
        print("[eval] \(job.rawValue): \(gate.summary)")
        for s in samples where s.deviceScore < 0.75 || !s.problems.isEmpty {
            print(String(format: "[eval]   %.2f %@ %@", s.deviceScore, s.name, s.problems.joined(separator: "; ")))
        }
        return gate
    }

    @Test func ingredientLines() async throws {
        guard #available(macOS 27, iOS 27, *) else { return }
        try #require(DeviceAI.isAvailable, "\(DeviceAI.unavailableReason ?? "")")
        let fixtures = Dictionary(try loadLines().map { ($0.line, $0) }, uniquingKeysWith: { a, _ in a })
        let recorder = Recorder()
        let result = try await IngredientLineEvaluation(fixtures: fixtures, recorder: recorder).run()
        print("[eval] ingredientLine framework mean: \(result.aggregateValue(.mean(of: Metric("score"))))")
        let gate = try await record(.ingredientLine, recorder, serverIs: "the rules (the server's paste import uses the same)")
        if AITask.ingredientLine.firstTry == .device { #expect(gate.passes, "\(gate.summary)") }
    }

    @Test func recipeCards() async throws {
        guard #available(macOS 27, iOS 27, *) else { return }
        try #require(DeviceAI.isAvailable, "\(DeviceAI.unavailableReason ?? "")")
        let context = AIContext(configured: true, measurementSystem: "metric", defaultPrompt: nil, kitchenEquipment: nil,
                                webGrounding: false, members: [], tasteProfile: nil, collections: [])
        let recorder = Recorder()
        let result = try await RecipeScanEvaluation(cards: try RecipeScanEvaluation.cards(), context: context, recorder: recorder).run()
        print("[eval] scanRecipe framework mean: \(result.aggregateValue(.mean(of: Metric("score"))))")
        let gate = try await record(.scanRecipe, recorder, serverIs: "not measured: no household key where this ran")
        if AITask.scanRecipe.firstTry == .device { #expect(gate.passes, "\(gate.summary)") }
    }

    @Test func readText() async throws {
        guard #available(macOS 27, iOS 27, *) else { return }
        try #require(DeviceAI.isAvailable, "\(DeviceAI.unavailableReason ?? "")")
        let context = AIContext(configured: true, measurementSystem: "metric", defaultPrompt: nil, kitchenEquipment: nil,
                                webGrounding: false, members: [], tasteProfile: nil, collections: [])
        let recorder = Recorder()
        _ = try await RecipeTextEvaluation(items: try RecipeTextEvaluation.items(), context: context, recorder: recorder).run()
        let gate = try await record(.readText, recorder, serverIs: "not measured: no household key where this ran")
        if AITask.readText.firstTry == .device { #expect(gate.passes, "\(gate.summary)") }
    }

    @Test func fileRecipe() async throws {
        guard #available(macOS 27, iOS 27, *) else { return }
        try #require(DeviceAI.isAvailable, "\(DeviceAI.unavailableReason ?? "")")
        let recorder = Recorder()
        _ = try await FileRecipeEvaluation(fixture: try CollectionsFixture.load(), recorder: recorder).run()
        let gate = try await record(.fileRecipe, recorder, serverIs: "not measured: no household key where this ran")
        if AITask.fileRecipe.firstTry == .device { #expect(gate.passes, "\(gate.summary)") }
    }

    @Test func cookAssist() async throws {
        guard #available(macOS 27, iOS 27, *) else { return }
        try #require(DeviceAI.isAvailable, "\(DeviceAI.unavailableReason ?? "")")
        struct File: Decodable { var recipes: [GeneratedRecipe] }
        let recipes = try JSONDecoder().decode(File.self, from: Data(contentsOf: fixtureURL("evals/recipe-cards.json"))).recipes
        let recorder = Recorder()
        _ = try await CookAssistEvaluation(fixture: try CookAssistFixture.load(), recipes: recipes, recorder: recorder).run()
        let gate = try await record(.cookAssist, recorder, serverIs: "not measured: no household key where this ran")
        if AITask.cookAssist.firstTry == .device { #expect(gate.passes, "\(gate.summary)") }
    }

    @Test func improveRecipe() async throws {
        guard #available(macOS 27, iOS 27, *) else { return }
        try #require(DeviceAI.isAvailable, "\(DeviceAI.unavailableReason ?? "")")
        struct File: Decodable { var recipes: [GeneratedRecipe] }
        let recipes = try JSONDecoder().decode(File.self, from: Data(contentsOf: fixtureURL("evals/recipe-cards.json"))).recipes
        let recorder = Recorder()
        _ = try await TweakEvaluation(fixture: try TweaksFixture.load(), recipes: recipes, recorder: recorder).run()
        let gate = try await record(.improveRecipe, recorder, serverIs: "not measured: no household key where this ran")
        if AITask.improveRecipe.firstTry == .device { #expect(gate.passes, "\(gate.summary)") }
    }

    @Test func recipeIdeas() async throws {
        guard #available(macOS 27, iOS 27, *) else { return }
        try #require(DeviceAI.isAvailable, "\(DeviceAI.unavailableReason ?? "")")
        let recorder = Recorder()
        _ = try await ConceptEvaluation(fixture: try ConceptsFixture.load(), recorder: recorder).run()
        let gate = try await record(.recipeIdeas, recorder, serverIs: "not measured: no household key where this ran")
        if AITask.recipeIdeas.firstTry == .device { #expect(gate.passes, "\(gate.summary)") }
    }

    @Test func mealPlan() async throws {
        guard #available(macOS 27, iOS 27, *) else { return }
        try #require(DeviceAI.isAvailable, "\(DeviceAI.unavailableReason ?? "")")
        let recorder = Recorder()
        _ = try await MealPlanEvaluation(fixture: try MealPlansFixture.load(), recorder: recorder).run()
        let gate = try await record(.mealPlan, recorder, serverIs: "not measured: no household key where this ran")
        if AITask.mealPlan.firstTry == .device { #expect(gate.passes, "\(gate.summary)") }
    }

    /// DISHES_EVAL_CARDS=<folder>: the printed cards as PNGs, to look at.
    @Test(.enabled(if: ProcessInfo.processInfo.environment["DISHES_EVAL_CARDS"] != nil))
    func writesTheCards() throws {
        guard #available(macOS 27, iOS 27, *) else { return }
        let folder = URL(filePath: ProcessInfo.processInfo.environment["DISHES_EVAL_CARDS"]!)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        for card in try RecipeScanEvaluation.cards().values {
            let url = folder.appending(path: card.name + ".png")
            let dest = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil)!
            CGImageDestinationAddImage(dest, card.image, nil)
            CGImageDestinationFinalize(dest)
        }
    }

    func loadLines() throws -> [IngredientLineFixture] {
        struct File: Decodable { var lines: [IngredientLineFixture] }
        return try JSONDecoder().decode(File.self, from: Data(contentsOf: fixtureURL("ingredient-lines.json"))).lines
    }
}

struct IngredientLineFixture: Decodable, Sendable {
    struct Parts: Decodable, Sendable { var amount: String; var unit: String; var name: String; var preparation: String }
    var line: String
    var expected: Parts
}
