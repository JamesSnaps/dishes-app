// A draft week on the device (TODO_MOBILE.md, D3; the server's version is
// `mealPlanFor`, POST /api/v1/ai/meal-plan): "plan next week from favourites,
// nothing twice in a fortnight" from the recipes, plans and cooks already on
// the iPad, offline. Adding the draft still goes to the server
// (`applyMealPlan`), which writes out any new ideas as recipes.
//
// The library is chosen by code, the same rules as the server's: mains only,
// favourites when asked, nothing the household or those eating rated 2★ or
// less, nothing used in the last three weeks (relaxed when that leaves too
// few), heart-healthy numbers when it's a heart-healthy week, then a random
// sample. Not a Tool the model calls to search the store: those rules are the
// household's own choices, applied exactly, and a small model makes one round
// trip fewer. The model then fills each slot from the library or with a new
// idea, picking by the slot's own field so every slot is answered once.
//
// The one difference from the server: at most `promptLimit` recipes go in the
// prompt (the server sends 120), to fit the on-device model's 4,096 tokens.

import Foundation
import FoundationModels

public enum MealPlanDrafter {
    static let cooldownWeeks = 3
    /// 2★ on the 0–10 scale cooks are rated on.
    static let dislikedAt = 4.0
    static let promptLimit = 30
    static let dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    static let newRecipe = "A new recipe"

    public struct Ask: Sendable {
        public var weekStartDate: String
        public var slots: [Slot]
        public var preferences: String
        public var memberIds: [String]
        public var favouritesOnly: Bool
        public var heartHealthy: Bool
        public struct Slot: Sendable, Hashable { public var dayOfWeek: Int; public var mealType: String
            public init(dayOfWeek: Int, mealType: String) { self.dayOfWeek = dayOfWeek; self.mealType = mealType } }
        public init(weekStartDate: String, slots: [Slot], preferences: String = "", memberIds: [String] = [],
                    favouritesOnly: Bool = false, heartHealthy: Bool = false) {
            self.weekStartDate = weekStartDate; self.slots = slots; self.preferences = preferences; self.memberIds = memberIds
            self.favouritesOnly = favouritesOnly; self.heartHealthy = heartHealthy
        }
    }

    /// What's on the device to plan from.
    public struct Household: Sendable {
        public var recipes: [Recipe]
        public var plans: [MealPlan]
        public var entries: [MealPlanEntry]
        public var cooks: [CookEntry]
        public init(recipes: [Recipe], plans: [MealPlan], entries: [MealPlanEntry], cooks: [CookEntry]) {
            self.recipes = recipes; self.plans = plans; self.entries = entries; self.cooks = cooks
        }
    }

    // MARK: The library

    public struct Pick: Sendable {
        public var recipe: Recipe
        public var timesPlanned: Int
        /// The later of last planned and last cooked, "yyyy-MM-dd".
        public var lastUsed: String?
        /// 0–10, the household's average.
        public var rating: Double?
        /// Those eating this week, 0–10.
        public var eaterRatings: [(name: String, average: Double)]
        public var note: String?
        /// Its # in the prompt's library.
        public var number = 0
    }

    public struct Library: Sendable {
        public var picks: [Pick]
        public var recent: [String]
        public var disliked: [String]
        public var cooldownUsed: Int
    }

    static func day(_ date: Date) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    /// "yyyy-MM-dd" at midnight UTC.
    static func date(_ day: String) -> Date? {
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    /// Whole weeks since; a future date is 0, as the server's are.
    static func weeks(since day: String, today: Date) -> Int {
        guard let then = date(day) else { return Int.max }
        return max(0, Int((today.timeIntervalSince(then) / (7 * 86_400)).rounded(.down)))
    }

    public static func library(_ ask: Ask, household h: Household, eating names: [String], today: Date,
                               diets: [String] = [], shuffle: (inout [Pick]) -> Void = { $0.shuffle() }) -> Library {
        let flags = diets.map { $0.lowercased() }
        let vegan = flags.contains { $0.contains("vegan") }
        let vegetarian = vegan || flags.contains { $0.contains("vegetarian") }
        let weekOf = Dictionary(h.plans.map { ($0.id, $0.weekStartDate) }, uniquingKeysWith: { a, _ in a })
        var planned: [String: (count: Int, last: String)] = [:]
        for e in h.entries {
            guard let id = e.recipeId, let week = weekOf[e.mealPlanId] else { continue }
            let was = planned[id]
            planned[id] = ((was?.count ?? 0) + 1, max(was?.last ?? "", week))
        }
        let cooksBy = Dictionary(grouping: h.cooks, by: \.recipeId)
        let wanted = Set(names.map { $0.lowercased().trimmingCharacters(in: .whitespaces) })

        var all: [(pick: Pick, used: Int, disliked: Bool)] = []
        for r in h.recipes where r.mealRole == nil || r.mealRole == "main" {
            let cooks = cooksBy[r.id] ?? []
            let lastCooked = cooks.map(\.cookedAt).max().map(day)
            let lastPlanned = planned[r.id]?.last
            let lastUsed = [lastCooked, lastPlanned].compactMap { $0 }.max()
            let ratings = cooks.compactMap(\.rating)
            let rating = ratings.isEmpty ? nil : ratings.reduce(0, +) / Double(ratings.count)
            var byPerson: [String: [Double]] = [:]
            for c in cooks { for m in c.memberRatings where wanted.contains(m.name.lowercased()) { byPerson[m.name, default: []].append(m.rating) } }
            let eaters = byPerson.map { (name: $0.key, average: $0.value.reduce(0, +) / Double($0.value.count)) }.sorted { $0.name < $1.name }
            let note = cooks.filter { !($0.notes ?? "").trimmingCharacters(in: .whitespaces).isEmpty }
                .max { $0.cookedAt < $1.cookedAt }?.notes?.trimmingCharacters(in: .whitespacesAndNewlines)
            let used = max(planned[r.id]?.count ?? 0, cooks.filter(\.isCook).count)
            let disliked = eaters.contains { $0.average <= dislikedAt } || (rating.map { $0 <= dislikedAt } ?? false)
            all.append((Pick(recipe: r, timesPlanned: planned[r.id]?.count ?? 0, lastUsed: lastUsed, rating: rating,
                             eaterRatings: eaters, note: note.map { $0.count > 80 ? String($0.prefix(77)) + "…" : $0 }), used, disliked))
        }

        func eligible(_ cooldown: Int) -> (picks: [Pick], recent: [String]) {
            var recent: [String] = []
            let picks = all.filter { item in
                let r = item.pick.recipe
                if ask.favouritesOnly && !r.isFavourite { return false }
                if vegetarian && !suits(r, vegan: vegan) { return false }
                if item.disliked { return false }
                if ask.heartHealthy, r.saturatedFatG != nil, r.fiberG != nil, !r.isHeartHealthy { return false }
                if let last = item.pick.lastUsed, weeks(since: last, today: today) < cooldown {
                    recent.append(r.title)
                    return false
                }
                return true
            }.map(\.pick)
            return (picks, recent)
        }

        var cooldown = cooldownWeeks
        var (picks, recent) = eligible(cooldown)
        if picks.count < ask.slots.count && !all.isEmpty {
            for relaxed in [1, 0] {
                let retry = eligible(relaxed)
                if retry.picks.count > picks.count { (picks, recent, cooldown) = (retry.picks, retry.recent, relaxed) }
                if picks.count >= ask.slots.count { break }
            }
        }
        shuffle(&picks)
        picks = Array(picks.prefix(promptLimit))
        for n in picks.indices { picks[n].number = n + 1 }
        return Library(picks: picks, recent: recent.sorted(),
                       disliked: all.filter(\.disliked).map(\.pick.recipe.title).sorted(), cooldownUsed: cooldown)
    }

    /// A recipe a vegetarian (or vegan) can eat, by its title, tags, description and ingredients.
    /// The server leaves this to its model; the on-device one picked prawn
    /// noodles for a vegetarian, so it's done here.
    static func suits(_ r: Recipe, vegan: Bool) -> Bool {
        if r.tags.contains(where: { $0.lowercased() == (vegan ? "vegan" : "vegetarian") }) { return true }
        let text = ([r.title, r.description ?? ""] + r.tags + r.ingredients.map(\.name)).joined(separator: " · ")
        let words = vegan ? ConceptChecks.meat + ConceptChecks.animal : ConceptChecks.meat
        return !words.contains { ConceptChecks.mentions(text, $0) }
    }

    // MARK: Drafting

    @available(iOS 27, macOS 27, *)
    public static func draft(_ ask: Ask, household: Household, context: AIContext?, today: Date = .now) async throws -> [APIClient.PlanSlot] {
        let eating = (context?.members ?? []).filter { ask.memberIds.contains($0.id) }
        let library = library(ask, household: household, eating: eating.map(\.displayName), today: today,
                              diets: eating.flatMap(\.dietaryFlags))
        let instructions = Prompts.mealPlan(ask, library: library, household: household, context: context, eating: eating, today: today)
        var slots = try await fill(ask.slots, ask: ask, library: library.picks, instructions: instructions, kept: [])

        // A dish picked twice: ask again for the later slots, with
        // what's chosen kept and taken out of the library (the server's
        // partial redo). Once; a repeat after that goes to the checks.
        var seen = Set<String>()
        let repeats = slots.indices.filter { !seen.insert(slots[$0].recipeId ?? slots[$0].title.lowercased()).inserted }
        if !repeats.isEmpty {
            let kept = slots.indices.filter { !repeats.contains($0) }.map { slots[$0] }
            let used = Set(kept.compactMap(\.recipeId))
            let again = try await fill(repeats.map { ask.slots[$0] }, ask: ask, library: library.picks.filter { !used.contains($0.recipe.id) },
                                       instructions: instructions, kept: kept)
            for (n, slot) in zip(repeats, again) { slots[n] = slot }
        }
        return slots
    }

    @available(iOS 27, macOS 27, *)
    static func fill(_ wanted: [Ask.Slot], ask: Ask, library picks: [Pick], instructions: String,
                     kept: [APIClient.PlanSlot]) async throws -> [APIClient.PlanSlot] {
        let labels = picks.map { p in "#\(p.number) \(p.recipe.title)" }
        let slotNames = wanted.map { "\(dayNames[$0.dayOfWeek]) \($0.mealType)" }
        // Each slot chooses only from what suits it: the server's "STRICT RULE",
        // by construction. Untagged recipes only for lunch and dinner — the
        // server's "when in doubt", where the model put a salad at breakfast.
        let choices = wanted.map { slot in
            picks.indices.filter { suits(picks[$0].recipe, slot.mealType) }.map { labels[$0] }
        }
        var request = Prompts.mealPlanRequest(ask, slotNames: slotNames)
        if !kept.isEmpty {
            request += " ALSO IN THIS PLAN (already chosen — do not repeat these dishes, and balance cuisine, protein and effort against them so the whole week still hangs together): "
                + kept.map { "\(dayNames[$0.dayOfWeek]) \($0.mealType) — \($0.title)" }.joined(separator: "; ") + "."
        }
        let session = LanguageModelSession(instructions: instructions)
        let answer = try await session.respond(to: request, schema: try schema(slots: Array(zip(slotNames, choices))))
        return wanted.enumerated().compactMap { n, slot in
            guard let filled = try? answer.content.value(GeneratedContent.self, forProperty: slotNames[n]) else { return nil }
            let text = { (key: String) in ((try? filled.value(String.self, forProperty: key)) ?? "").trimmingCharacters(in: .whitespaces) }
            var out = APIClient.PlanSlot(dayOfWeek: slot.dayOfWeek, mealType: slot.mealType, title: text("title"),
                                         description: text("description"), cuisine: text("cuisine"),
                                         difficulty: RecipeChecks.difficulties.contains(text("difficulty")) ? text("difficulty") : "medium")
            if let at = choices[n].firstIndex(of: text("recipe")).flatMap({ labels.firstIndex(of: choices[n][$0]) }) {
                let r = picks[at].recipe
                out.recipeId = r.id
                out.title = r.title
                out.cuisine = r.cuisine ?? out.cuisine
                out.difficulty = r.difficulty?.rawValue ?? out.difficulty
            }
            return out
        }
    }

    /// Whether a library recipe may go in a slot of this meal type.
    static func suits(_ r: Recipe, _ mealType: String) -> Bool {
        r.mealTypes.isEmpty ? ["lunch", "dinner"].contains(mealType) : r.mealTypes.contains(mealType)
    }

    @available(iOS 27, macOS 27, *)
    static func schema(slots: [(name: String, choices: [String])]) throws -> GenerationSchema {
        let text = DynamicGenerationSchema(type: String.self)
        func meal(_ n: Int, _ choices: [String]) -> DynamicGenerationSchema {
            DynamicGenerationSchema(name: "Meal\(n)", properties: [
                .init(name: "recipe", description: "A recipe from the library by its #, or “\(newRecipe)”",
                      schema: DynamicGenerationSchema(name: "Choice\(n)", anyOf: [newRecipe] + choices)),
                .init(name: "title", description: "The dish's name", schema: text),
                .init(name: "description", description: "One or two sentences on the dish", schema: text),
                .init(name: "cuisine", schema: text),
                .init(name: "difficulty", schema: DynamicGenerationSchema(name: "Difficulty\(n)", anyOf: ["easy", "medium", "hard"])),
            ])
        }
        return try GenerationSchema(root: DynamicGenerationSchema(
            name: "Plan", properties: slots.enumerated().map { .init(name: $0.element.name, schema: meal($0.offset, $0.element.choices)) }),
                                    dependencies: [])
    }
}

/// What a draft from the device must get right before it's shown.
public enum PlanChecks {
    public static func problems(_ slots: [APIClient.PlanSlot], ask: MealPlanDrafter.Ask, library: MealPlanDrafter.Library,
                                eating: [AIContext.Member]) -> [String] {
        var out: [String] = []
        if slots.count != ask.slots.count { out.append("\(slots.count) meals for \(ask.slots.count) slots") }
        if slots.contains(where: { $0.title.isEmpty }) { out.append("a meal with no name") }
        let titles = slots.map { $0.title.lowercased() }
        if Set(titles).count != titles.count { out.append("the same meal twice") }
        let avoid = Set((library.recent + library.disliked).map { $0.lowercased() })
        if let bad = slots.first(where: { $0.recipeId == nil && avoid.contains($0.title.lowercased()) }) {
            out.append("“\(bad.title)” was cooked recently or rated low")
        }
        // Favourites only, and enough of them suit the slots: a new idea isn't one.
        let suitable = library.picks.filter { p in ask.slots.contains { p.recipe.mealTypes.isEmpty || p.recipe.mealTypes.contains($0.mealType) } }
        if ask.favouritesOnly, suitable.count >= ask.slots.count, let bad = slots.first(where: { $0.recipeId == nil }) {
            out.append("“\(bad.title)” isn’t a favourite")
        }
        let concepts = slots.map { APIClient.Concept(title: $0.title, description: $0.description, difficulty: $0.difficulty) }
        out += ConceptChecks.problems(concepts, eating: eating).filter { !$0.contains("ideas, not five") && $0 != "the same idea twice" }
        return out
    }
}
