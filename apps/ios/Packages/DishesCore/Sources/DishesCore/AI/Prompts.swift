// The on-device prompts: Swift copies of the server's, so a recipe read on
// the iPad follows the same rules as one read by the server (TODO_MOBILE.md,
// Phase D2). Each says which server function it copies — change one, change
// the other (the server's side points back here).
//
// The JSON schema text the server spells out in its prompts isn't copied:
// guided generation (`@Generable`) gives the on-device model the shape itself.

import Foundation

public enum Prompts {
    /// Copy of `buildSystemAddendum` (apps/web/lib/ai/recipe-generation.ts):
    /// the household's measurement system, default prompt and equipment.
    public static func systemAddendum(_ context: AIContext?, measurements: Bool = true) -> String {
        guard let context else { return "" }
        var parts: [String] = []
        if measurements, context.measurementSystem == "metric" {
            parts.append("Always use metric measurements only: grams (g), millilitres (ml), kilograms (kg), litres (l). Never use cups, tablespoons, teaspoons, fluid ounces, pounds, or any other imperial or US customary units.")
        }
        if let prompt = context.defaultPrompt?.trimmingCharacters(in: .whitespacesAndNewlines), !prompt.isEmpty {
            parts.append(prompt)
        }
        if let equipment = context.kitchenEquipment?.trimmingCharacters(in: .whitespacesAndNewlines), !equipment.isEmpty {
            parts.append("Available kitchen equipment: \(equipment). Size recipes to fit this equipment where relevant.")
        }
        return parts.isEmpty ? "" : "\n\nAdditional requirements: " + parts.joined(separator: " ")
    }

    /// What a recipe is being read from.
    public enum Source: Sendable { case page, text }

    /// Copy of `recipeExtractionPrompt` (apps/web/app/actions/ai.ts) — the
    /// system prompt of `analyzeRecipePhoto` and `analyzeRecipeText` — less its
    /// JSON schema. For a page the device reads the text with Vision first, so
    /// the prompt says the text comes with it.
    ///
    /// One difference on purpose: no "always use metric". The on-device model
    /// took it as an order to put metric units on everything — "4 ripe
    /// tomatoes" came back as "4 kg tomato". Reading a page is transcription;
    /// a metric household's recipe in cups or ounces fails RecipeChecks and
    /// goes to the server, which converts it.
    public static func readRecipe(_ context: AIContext?, from source: Source = .page) -> String {
        let from = switch source {
        case .page: """
            Extract the complete recipe from the provided image of a cookbook page, recipe card or screenshot. The \
            text recognised on the page is given with it, in reading order; use it for the exact wording, amounts and \
            units, and the image for the layout (which lines are ingredients, which are method, and section headings \
            such as "For the sauce").
            """
        case .text: """
            Extract the complete recipe from the provided text — copied from a website, a message, notes or a \
            caption. Leave out anything that isn't the recipe: chat, stories, hashtags, links.
            """
        }
        return "You are a recipe digitisation assistant. " + from + "\n" + """
        Keep every ingredient and every step, in order. Put any preparation ("finely chopped") in its own field, \
        not in the name. A step's duration is in whole minutes, only when the step says how long. Use the same \
        group label for an ingredient section and the matching method section.
        Copy each ingredient's quantity exactly as written in front of it — "250g", "2 tbsp", "1-2", "6" — and \
        never add a measure that isn't there. "6 shallots, halved" is quantity "6", name "shallots", \
        preparation "halved"; "1 cinnamon stick" is quantity "1", name "cinnamon stick".
        An ingredient listed with no quantity still has its name; words after a comma go in its preparation.
        If a value isn't given, leave it empty — except the title: when there's none, name the dish plainly from \
        what it is ("here's my nan's pasta bake" is "Pasta Bake"). Never invent information that isn't there.
        """ + systemAddendum(context, measurements: false)
    }

    /// No server copy: the server reads pasted lines with rules alone
    /// (`splitIngredientsText`). These instructions take over where the rules
    /// misread a line (IngredientRules.isUnsure).
    public static let readIngredientLine = """
        You split one line of a recipe's ingredient list into its parts, exactly as written. \
        amount: the number only — "2", "1/2", "1 1/2", "1-2" — or empty. Words become numbers: "a" or "an" is "1", "half" is "1/2". \
        unit: the measure, as written — "g", "ml", "tbsp", "tsp", "cups", "pinch", "handful", "bunch", "rashers" — or empty when the amount counts the ingredient itself ("2 onions"). \
        name: the ingredient only, keeping words that say which one ("flat-leaf parsley", "large red onion", "400g tins chickpeas"). \
        preparation: what is done to it — "finely chopped", "softened", "skin on" — or empty. Words that say what is sold stay in the name: "chopped tomatoes" from a tin, "ground cumin", "smoked paprika".
        Never add anything that isn't in the line, and leave out notes such as "(about 600g)" or "(optional)".
        Examples (none of them are in the evaluation set — keep it that way, or its score means nothing):
        "1 tbsp roughly chopped coriander" → amount "1", unit "tbsp", name "coriander", preparation "roughly chopped"
        "juice of 2 limes" → amount "2", unit "", name "limes", preparation "juiced"
        "zest of 1 lemon" → amount "1", unit "", name "lemon", preparation "zested"
        "pinch of salt" → amount "1", unit "pinch", name "salt", preparation ""
        "half an onion, sliced" → amount "1/2", unit "", name "onion", preparation "sliced"
        "100 g grated parmesan" → amount "100", unit "g", name "parmesan", preparation "grated"
        """

    /// Copy of `collectionSuggestionFor`'s system prompt (apps/web/app/actions/ai.ts),
    /// less its JSON format: the schema allows only the listed names or none.
    /// ShoppingAisles: one shopping list item → the aisle of a UK supermarket it's in.
    public static let fileShoppingItem = """
        You sort a family's shopping list into the aisles of a UK supermarket. You are given one item as they typed \
        it. Answer the aisle it is sold in: Produce (fresh fruit, vegetables and herbs), Dairy (milk, cheese, eggs, \
        yoghurt, butter), Meat, Fish, Bakery (bread and baked goods), Pantry (tins, jars, dried food, sauces, spices, \
        snacks), Frozen, Drinks, Cleaning (household cleaning and paper goods), or Other (toiletries, pets, anything \
        else). If you don't recognise the item, answer “\(ShoppingAisles.notSure)” — leaving it unsorted is better than \
        a wrong aisle.
        """

    public static let fileRecipe = """
        You file new recipes into a family's existing recipe collections. Choose a collection ONLY when the recipe \
        clearly and obviously belongs in it, judging by the collection's name and description. If no collection is a \
        clear fit, answer “\(CollectionPicker.none)” — leaving a recipe uncategorised is far better than filing it in \
        the wrong place.
        """

    /// Copy of the same function's user message.
    public static func fileRecipeQuestion(_ recipe: GeneratedRecipe, collections: [AIContext.Collection]) -> String {
        let list = collections.map { c in
            "- \(c.name)" + (c.description.map { $0.trimmingCharacters(in: .whitespaces) }.flatMap { $0.isEmpty ? nil : ": \($0)" } ?? "")
        }.joined(separator: "\n")
        let lines = [
            "Title: \(recipe.title)",
            recipe.description.isEmpty ? nil : "Description: \(recipe.description)",
            recipe.cuisine.isEmpty ? nil : "Cuisine: \(recipe.cuisine)",
            recipe.mealTypes.isEmpty ? nil : "Meal types: \(recipe.mealTypes.joined(separator: ", "))",
            recipe.tags.isEmpty ? nil : "Tags: \(recipe.tags.joined(separator: ", "))",
        ].compactMap { $0 }.joined(separator: "\n")
        return "Existing collections:\n\(list)\n\nNew recipe:\n\(lines)\n\nWhich collection does this recipe belong in?"
    }
    /// Copy of the system prompt in apps/web/app/api/cook-assist/route.ts:
    /// "Ask about this step" in cooking mode, with the whole recipe.
    public static func cookAssist(_ c: APIClient.CookAssistContext) -> String {
        let format = { (i: APIClient.CookAssistContext.Ingredient) in
            [i.amount, i.unit, i.name].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
        }
        let used = c.stepIngredients.isEmpty ? "none listed" : c.stepIngredients.map(format).joined(separator: ", ")
        let ingredients = c.allIngredients.isEmpty ? "not provided" : c.allIngredients.map { "- " + format($0) }.joined(separator: "\n")
        let steps = c.allSteps.isEmpty ? "not provided"
            : c.allSteps.map { "\($0.number == c.stepNumber ? "→" : " ") \($0.number). \($0.instruction)" }.joined(separator: "\n")
        return """
            You are a helpful cooking assistant. Someone is actively cooking and has a quick question — answer concisely \
            and practically. They may have messy hands so keep it to 2–4 sentences unless a short list genuinely helps.

            You have the whole recipe below, not just the current step. Use it: when the question touches on what comes \
            next, what was done earlier, timing across steps, leftover quantities of an ingredient, or substitutions, \
            reason over the full recipe rather than the current step alone. Do not tell the user to check the recipe — \
            you can already see it.

            Recipe: \(c.recipeTitle)
            \(c.servingsSummary.map { "\($0)\n" } ?? "")
            All ingredients:
            \(ingredients)

            All steps (→ marks the step they are on now):
            \(steps)

            They are currently on step \(c.stepNumber): \(c.stepInstruction)
            Ingredients used in this step: \(used)
            """
    }
    /// Copy of `improveRecipe`'s system prompt (apps/web/app/actions/ai.ts),
    /// asking for the edits rather than the whole recipe (RecipeTweaker).
    public static func improveRecipe(_ context: AIContext?) -> String {
        """
        You are a chef editing an existing recipe based on a user's request. List only the changes needed to satisfy \
        the request; everything you don't list stays exactly as it is.
        When the user asks to add, remove, or change an ingredient, you MUST add it, remove it, or change it in the \
        ingredients. NEVER leave a removed ingredient in the list. NEVER write workaround instructions in steps such as \
        "skip the X", "omit the X", or "ignore the X" — make the actual change instead, and change any step that \
        mentions an ingredient you've replaced.
        """ + systemAddendum(context)
    }

    /// Each ingredient as a line ("500g beef mince", "2 garlic cloves, crushed"),
    /// unique, so an edit can name the one it means.
    public static func ingredientLines(_ recipe: GeneratedRecipe) -> [String] {
        var seen: [String: Int] = [:]
        return recipe.ingredients.map { i in
            let quantity = [i.amount, i.unit].filter { !$0.isEmpty }.joined(separator: i.unit.count > 2 ? " " : "")
            var line = [quantity, i.ingredientName].filter { !$0.isEmpty }.joined(separator: " ")
                + (i.preparation.isEmpty ? "" : ", \(i.preparation)") + (i.isOptional ? " (optional)" : "")
            seen[line, default: 0] += 1
            if seen[line]! > 1 { line += " (\(seen[line]!))" }
            return line
        }
    }

    /// The recipe, its lines as the edits name them, and the request.
    public static func improveRecipeRequest(_ recipe: GeneratedRecipe, instruction: String) -> String {
        let ingredients = ingredientLines(recipe).map { "- \($0)" }.joined(separator: "\n")
        let steps = recipe.steps.enumerated().map { "Step \($0.offset + 1): \($0.element.instruction)" }.joined(separator: "\n")
        return """
            Here is the current recipe:
            \(recipe.title) — serves \(recipe.servings)

            Ingredients:
            \(ingredients)

            Method:
            \(steps)

            User request: \(instruction)
            """
    }
    /// Copy of `HEART_HEALTHY_GUIDANCE` (apps/web/lib/ai/recipe-generation.ts).
    public static let heartHealthyGuidance = "It must suit a cholesterol-lowering diet: at most 4g saturated fat and at least 3g fibre per serving. Cook with olive or rapeseed oil, not butter, ghee, lard or coconut oil. Favour fish (oily fish is ideal), skinless poultry, beans, lentils, chickpeas and tofu over fatty or processed red meat. Swap cream, full-fat cheese and coconut milk for low-fat yoghurt, reduced-fat alternatives or a small amount of a strongly flavoured cheese. Build in oats, barley, pulses, wholegrains, vegetables and nuts. Keep salt moderate. It should still taste generous — make swaps, don't just shrink the portion."

    /// Copy of `buildMemberConstraints` (apps/web/app/actions/ai.ts): who's eating.
    public static func memberConstraints(_ eating: [AIContext.Member], year: Int) -> String {
        guard !eating.isEmpty else { return "" }
        var youngChild = false, cholesterol = false
        let lines = eating.map { m -> String in
            var who = m.displayName
            if let born = m.birthYear {
                who += " (age \(year - born))"
                if year - born <= 8 { youngChild = true }
            } else if m.role == "child" {
                who += " (a child)"
                youngChild = true
            }
            var parts = ["\(who):"]
            if !m.dietaryFlags.isEmpty { parts.append("dietary requirements: \(m.dietaryFlags.joined(separator: ", "))") }
            if m.dietaryFlags.contains("Cholesterol-lowering") { cholesterol = true }
            if !m.dislikes.isEmpty { parts.append("dislikes: \(m.dislikes.joined(separator: ", "))") }
            if !m.preferences.isEmpty { parts.append("loves: \(m.preferences.joined(separator: ", "))") }
            if let notes = m.customNotes?.trimmingCharacters(in: .whitespacesAndNewlines), !notes.isEmpty { parts.append(notes) }
            return parts.joined(separator: " — ")
        }
        var out = "\n\nWho's eating: \(lines.joined(separator: "; ")). Please respect all dietary requirements, avoid any listed dislikes, and lean towards their preferences where possible."
        if youngChild {
            out += " One or more diners is a young child, so keep every suggestion genuinely simple, mild and child-friendly with small, age-appropriate portions and easy-to-eat textures. Do not suggest elaborate, rich or restaurant-style dishes, and avoid common choking hazards for very young children."
        }
        if cholesterol {
            out += " Someone eating is on a cholesterol-lowering diet, so every dish must be heart-healthy. \(heartHealthyGuidance)"
        }
        return out
    }

    /// Copy of `buildTasteProfileAddendum` (apps/web/app/actions/ai.ts).
    public static func tasteProfile(_ profile: AIContext.TasteProfile?) -> String {
        guard let profile else { return "" }
        let score = { (s: Double) in s.rounded() == s ? String(Int(s)) : String(s) }
        var lines = ["\n\nHousehold taste profile (from \(profile.ratedCookCount) rated cooks):"]
        if !profile.preferredCuisines.isEmpty {
            lines.append("- Preferred cuisines: " + profile.preferredCuisines.map { "\($0.name) (\(score($0.score))/5)" }.joined(separator: ", "))
        }
        if !profile.lovedIngredients.isEmpty { lines.append("- Loved ingredients: \(profile.lovedIngredients.joined(separator: ", "))") }
        if !profile.dislikedIngredients.isEmpty { lines.append("- Disliked ingredients: \(profile.dislikedIngredients.joined(separator: ", "))") }
        lines.append("Lean towards their preferred cuisines and loved ingredients. Strictly avoid their disliked ingredients.")
        return lines.joined(separator: "\n")
    }

    /// Copy of `conceptsFor`'s system prompt (apps/web/app/actions/ai.ts), less
    /// its JSON format (guided generation gives the shape). The concierge
    /// doesn't send a meal role, so its sentences aren't copied. One change:
    /// the side-dish sentence leads with "a dish to eat as a meal" — as the
    /// server words it, the on-device model answered "a cosy pasta dish" with
    /// five sauces and dips.
    public static func concepts(_ context: AIContext?, eating: [AIContext.Member], mealType: String?, heartHealthy: Bool, year: Int) -> String {
        var extra = ""
        if let mealType, !mealType.isEmpty {
            let light = mealType.lowercased().contains(/breakfast|lunch|snack|brunch/)
            extra += "\nIMPORTANT: All 5 concepts must be \(mealType) recipes that are genuinely appropriate for \(mealType)."
                + (light ? " Keep them light and easy — \(mealType)-sized, not full dinner-style meals." : "")
        }
        if heartHealthy {
            extra += "\nIMPORTANT: Every concept must be a naturally heart-healthy dish for someone lowering their cholesterol — built around fish, pulses, wholegrains, vegetables and unsaturated fats, not cream, butter, cheese or fatty red meat. \(heartHealthyGuidance)"
        }
        return """
            You are a helpful chef helping a family choose what to cook. Return exactly 5 distinct recipe concepts.
            Make the 5 concepts meaningfully different from each other in style or cuisine, but always match their effort, \
            richness and portion size to what the user actually asked for. If the user asks for something simple, quick, \
            light or for a child, every concept must stay simple — do not pad the list with elaborate or restaurant-style \
            dishes. Every concept is a dish to eat as a meal — unless they ask for a side dish, sauce or extra, in which \
            case every concept must be that kind of dish and not a main course.
            """ + extra + systemAddendum(context) + tasteProfile(context?.tasteProfile) + memberConstraints(eating, year: year)
    }
    /// Copy of `mealPlanFor`'s system prompt (apps/web/app/actions/ai.ts), less
    /// its JSON format and the options the app doesn't send (cuisine, tag,
    /// calorie and "not tried" filters, partial redos). The library lines are
    /// shorter (no tags), to fit the on-device model.
    public static func mealPlan(_ ask: MealPlanDrafter.Ask, library: MealPlanDrafter.Library, household: MealPlanDrafter.Household,
                                context: AIContext?, eating: [AIContext.Member], today: Date) -> String {
        let fivePoint = { (r: Double) in String(format: "%g", (r * 5).rounded() / 10) }
        var lib = ""
        if !library.picks.isEmpty {
            let eaters = library.picks.contains { !$0.eaterRatings.isEmpty }
            lib = "\n\nRECIPE LIBRARY — choose one by its # in a slot's \"recipe\" to reuse it. Each recipe can only appear once per plan. The list is in random order and every entry is an equally valid choice: do NOT prefer a recipe because it is highly rated or often cooked, and do NOT avoid one because it is unrated or never tried. Pick on fit for the slot alone. A \"note:\" is the household's own feedback from the last time they cooked it — treat it as authoritative and let it steer which slot the recipe suits, or whether to pick it at all."
                + (eaters ? " The one exception to ignoring ratings: \"eaters rated:\" is what the specific people eating this week have said about that dish. Favour dishes they rated 4/5 or more, and pick a dish rated 3/5 or less by any of them only when nothing else fits." : "")
                + "\n" + library.picks.map { p in
                    let r = p.recipe
                    var facts = [r.cuisine ?? "various", r.difficulty?.rawValue ?? "medium", p.rating.map { "⭐\(fivePoint($0))/5" } ?? "unrated"]
                    if !p.eaterRatings.isEmpty { facts.append("eaters rated: " + p.eaterRatings.map { "\($0.name) \(fivePoint($0.average))/5" }.joined(separator: ", ")) }
                    if let kcal = r.calories { facts.append("~\(Int(kcal))kcal") }
                    if ask.heartHealthy { facts.append(r.isHeartHealthy ? "heart-healthy ✓" : "heart-healthy: unknown") }
                    if let minutes = r.totalMinutes { facts.append("\(minutes)min") }
                    facts.append("suits: " + (r.mealTypes.isEmpty ? "untagged" : r.mealTypes.joined(separator: "/")))
                    let history = p.timesPlanned == 0 && p.lastUsed == nil ? "never tried"
                        : "cooked \(p.timesPlanned)×" + (p.lastUsed.map { ", " + relativeWeeks($0, today: today) } ?? "")
                    return "#\(p.number) \(r.title) [\(facts.joined(separator: ", "))] — \(history)" + (p.note.map { " — note: \"\($0)\"" } ?? "")
                }.joined(separator: "\n")
                + "\n\nFor each slot: choose a library recipe to reuse it, or “\(MealPlanDrafter.newRecipe)” to suggest a brand-new one. STRICT RULE: only reuse a library recipe in a slot whose meal type is listed in that recipe's \"suits:\" field. For recipes marked \"suits: untagged\" the meal type is unknown — only reuse one in a breakfast/snack/dessert slot if its title makes it unmistakably suitable; when in doubt suggest a new one. If nothing in the library suits the slot, suggest a fitting new recipe instead.\n\nVARIETY IS A PRIORITY. Spread your picks right across the list rather than clustering on the entries near the top or on one style of dish, and vary cuisine and main protein across the week. Treat the whole list as fair game."
        }
        var extra = ""
        if ask.heartHealthy {
            extra += "\n\nHEART-HEALTHY WEEK — this household is following a cholesterol-lowering diet. Across a full week of dinners: oily fish (salmon, mackerel, sardines, trout) at least twice; a meal built mainly on beans, lentils, chickpeas or tofu at least three times; red meat at most once, and no processed meat (bacon, sausages, ham, salami). These are targets for the WHOLE week: meals listed under \"ALREADY PLANNED THIS WEEK\" count towards them, so work out what those meals already contribute and use your slots to make up the shortfall. Only when the week is otherwise empty and you are planning just a few slots, scale the targets down in proportion. Breakfasts should lean on oats, wholegrains, fruit, nuts and low-fat yoghurt rather than fry-ups, pastries or butter. Library recipes marked \"heart-healthy ✓\" already meet the targets; only reuse one marked \"heart-healthy: unknown\" if it is plainly a lean, vegetable- or pulse-led dish. For new suggestions: \(heartHealthyGuidance)"
        }
        if !library.disliked.isEmpty {
            extra += "\n\nDISLIKED — rated 2/5 or lower by the household or by someone eating this week, so don't suggest them or close variations: \(library.disliked.prefix(30).joined(separator: "; "))."
        }
        if !library.recent.isEmpty {
            extra += "\n\nRECENTLY COOKED (last \(library.cooldownUsed) weeks) — do NOT suggest these again this week: \(library.recent.prefix(30).joined(separator: ", "))."
        }
        let week = household.plans.first { $0.weekStartDate == ask.weekStartDate }?.id
        let byId = Dictionary(household.recipes.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let already = household.entries.filter { $0.mealPlanId == week }.compactMap { e -> String? in
            guard let r = e.recipeId.flatMap({ byId[$0] }) else { return nil }
            let facts = [r.cuisine, r.calories.map { "\(Int($0)) kcal" }, ask.heartHealthy && r.isHeartHealthy ? "heart-healthy ✓" : nil].compactMap { $0 }
            return "\(MealPlanDrafter.dayNames[min(max(e.dayOfWeek, 0), 6)]) \(e.mealType) — \(r.title)" + (facts.isEmpty ? "" : " (\(facts.joined(separator: ", ")))")
        }
        if !already.isEmpty {
            extra += "\n\nALREADY PLANNED THIS WEEK — these meals are part of the same week as the ones you are planning, so treat the week as a whole: do not repeat these dishes, balance cuisine, main protein and vegetables against them, and count them towards any weekly targets below rather than planning your slots as a separate mini-week: \(already.joined(separator: "; "))."
        }
        if let start = MealPlanDrafter.date(ask.weekStartDate) {
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_GB")
            f.timeZone = TimeZone(identifier: "UTC")
            f.dateFormat = "d MMMM yyyy"
            let long = f.string(from: start)
            f.dateFormat = "MMMM"
            extra += "\n\nThis plan is for the week beginning \(long). Favour dishes and produce that suit \(f.string(from: start)) in the UK — lighter, fresher food in warm months, and slower, heartier food in cold ones."
        }
        let year = Calendar(identifier: .gregorian).component(.year, from: today)
        return """
            You are a meal planning chef helping a family plan their week.
            Make meals varied across the week.\(ask.preferences.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "" : "\nThe family's own request, in the message below, comes before every guideline here except dietary requirements and allergies.")
            CRITICAL — each suggestion MUST genuinely suit its slot's meal type:
            - breakfast: breakfast-appropriate food only (eggs, pancakes, porridge, pastries, granola, fruit, breakfast wraps, etc.). Never put rich dinner-style dishes (pasta, curries, roasts, stews) in a breakfast slot.
            - lunch: light, quick, midday food — salads, sandwiches, wraps, soups, grain bowls, leftovers-style plates. Keep portions and richness modest; do NOT assign full dinner-style mains to lunch.
            - dinner: the main heartier meal of the day.
            - snack: small, simple bites. dessert: sweet courses only.
            If a slot's meal type can't be satisfied by a sensible dish, suggest a new one rather than forcing an ill-fitting recipe.
            """ + lib + systemAddendum(context) + tasteProfile(context?.tasteProfile) + extra + memberConstraints(eating, year: year)
    }

    /// Copy of the same function's user message, with `planRequestBlock`.
    /// (`PlanGeneratorSheet` sends a typed request to the server, so the device
    /// only sees one from the evaluations.)
    public static func mealPlanRequest(_ ask: MealPlanDrafter.Ask, slotNames: [String]) -> String {
        let preferences = String(ask.preferences.prefix(500)).trimmingCharacters(in: .whitespacesAndNewlines)
        return "Plan these meals: \(slotNames.joined(separator: ", ")). Return exactly \(slotNames.count) suggestions."
            + (preferences.isEmpty ? "" : """


                WHAT WE'VE ASKED FOR, in our own words: "\(preferences)"
                This comes first. It overrides variety, seasonality and the recipe library, but never anyone's dietary requirements or allergies. If it asks for a kind of dish, plan that kind of dish. If it rules something out, or says we don't have something, nothing you suggest may contain it. If it's about one day or meal, apply it there. Reuse a library recipe only when its title plainly fits the request; otherwise suggest a new recipe that does.
                """)
    }

    static func relativeWeeks(_ day: String, today: Date) -> String {
        let weeks = MealPlanDrafter.date(day).map { Int((today.timeIntervalSince($0) / (7 * 86_400)).rounded(.down)) } ?? 0
        if weeks <= 0 { return "this week" }
        if weeks == 1 { return "1 week ago" }
        if weeks < 8 { return "\(weeks) weeks ago" }
        return "\(weeks / 4) months ago"
    }
}
