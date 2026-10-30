// Which aisle a shopping item goes in, so nobody files them by hand. The add
// field and "Sort into aisles" both come here, after the household's own
// history (an item filed before goes back where it was):
//
//   1. The rules — a UK supermarket's words for each aisle, longest match
//      first, so "chicken stock" is Pantry and "frozen peas" Frozen
//   2. The on-device model, only for a name the rules don't know; it can only
//      answer one of the aisles or "not sure" (a dynamic schema lists them)
//   3. Otherwise nil: the item stays Uncategorised, as typed
//
//   let aisle = await ShoppingAisles.file("Halloumi")?.value   // "Dairy"

import Foundation
import FoundationModels

public enum ShoppingAisles {
    /// The web's CATEGORY_ORDER (shopping-list-client.tsx): the aisles, in walking order.
    public static let all = ["Produce", "Dairy", "Meat", "Fish", "Bakery", "Pantry", "Frozen", "Drinks", "Cleaning", "Other"]

    static let notSure = "Not sure"

    /// The aisle for one item name: the rules, then the model. nil when neither knows.
    public static func file(_ name: String) async -> AIRun<String?>? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if let ruled = rule(trimmed) { return AIRun(value: ruled, engine: .rules) }
        return try? await AIRouter.run(
            .shoppingAisle,
            onDevice: {
                guard #available(iOS 27, macOS 27, *) else { throw DeviceAIUnavailable() }
                return try await modelFile(trimmed)
            },
            check: { answer in answer.map { all.contains($0) ? [] : ["“\($0)” isn’t an aisle"] } ?? [] },
            fallback: { nil })
    }

    /// The rules' aisle, or nil when no word in the name is one they know.
    public static func rule(_ name: String) -> String? {
        let text = " " + name.lowercased()
            .replacingOccurrences(of: "crème fraîche", with: "creme fraiche")
            .components(separatedBy: CharacterSet.letters.inverted)
            .filter { !$0.isEmpty }
            .joined(separator: " ") + " "
        var best: (aisle: String, length: Int)?
        for (word, aisle) in words where word.count > (best?.length ?? 0) {
            // Whole words, plural or not: "tomato" finds "tomatoes", "egg" finds "eggs".
            if text.contains(" \(word) ") || text.contains(" \(word)s ") || text.contains(" \(word)es ") {
                best = (aisle, word.count)
            }
        }
        // Frozen beats whatever's frozen ("frozen peas", "frozen prawns").
        if text.contains(" frozen ") { return "Frozen" }
        return best?.aisle
    }

    @available(iOS 27, macOS 27, *)
    static func modelFile(_ name: String) async throws -> String? {
        let schema = try GenerationSchema(root: DynamicGenerationSchema(
            name: "Aisle",
            properties: [.init(name: "aisle", description: "The aisle's exact name, or “\(notSure)”",
                               schema: DynamicGenerationSchema(name: "AisleName", anyOf: all + [notSure]))]),
            dependencies: [])
        let session = LanguageModelSession(instructions: Prompts.fileShoppingItem)
        let answer = try await session.respond(to: name, schema: schema)
        let picked = try answer.content.value(String.self, forProperty: "aisle")
        return all.contains(picked) ? picked : nil
    }

    /// Word (or phrase) → aisle. A longer match wins, so a phrase here is how
    /// an exception is made ("butter beans", "coconut milk", "fish sauce").
    static let words: [(String, String)] = {
        let table: [String: [String]] = [
            "Produce": [
                "apple", "banana", "orange", "lemon", "lime", "grape", "pear", "peach", "nectarine", "plum", "mango",
                "pineapple", "melon", "watermelon", "kiwi", "berries", "strawberry", "strawberries", "raspberry",
                "raspberries", "blueberry", "blueberries", "blackberries", "cherry", "cherries", "avocado", "tomato",
                "potato", "sweet potato", "onion", "spring onion", "shallot", "garlic", "ginger", "carrot", "parsnip",
                "swede", "turnip", "celery", "celeriac", "leek", "cabbage", "cauliflower", "broccoli", "tenderstem",
                "kale", "spinach", "lettuce", "rocket", "salad", "cucumber", "courgette", "aubergine", "pepper",
                "chilli", "mushroom", "corn on the cob", "sugar snap", "mangetout", "green beans", "runner beans",
                "asparagus", "beetroot", "radish", "fennel", "pak choi", "bok choy", "parsley", "coriander", "basil",
                "mint", "thyme", "rosemary", "dill", "chives", "sage", "squash", "butternut squash", "pumpkin",
                "sprouts", "beansprouts", "lemongrass", "fruit", "veg", "vegetables", "herbs", "rhubarb", "clementine",
                "satsuma", "grapefruit", "spring greens", "watercress", "edamame",
            ],
            "Dairy": [
                "milk", "butter", "cheese", "cheddar", "mozzarella", "parmesan", "feta", "halloumi", "paneer",
                "ricotta", "mascarpone", "brie", "camembert", "stilton", "gruyere", "cream", "double cream",
                "single cream", "soured cream", "sour cream", "creme fraiche", "yoghurt", "yogurt", "egg", "custard",
                "cream cheese", "cottage cheese", "quark", "skyr", "kefir", "margarine",
            ],
            "Meat": [
                "chicken", "beef", "pork", "lamb", "mince", "steak", "sausage", "bacon", "ham", "chorizo", "salami",
                "pancetta", "turkey", "duck", "gammon", "burger", "meatballs", "thighs", "drumsticks", "venison",
                "prosciutto", "pepperoni", "brisket", "ribs", "lardons", "black pudding",
            ],
            "Fish": [
                "fish", "salmon", "smoked salmon", "cod", "haddock", "tuna", "prawn", "king prawns", "mackerel",
                "sea bass", "trout", "scallops", "mussels", "squid", "crab", "sardines", "hake", "pollock", "seafood",
            ],
            "Bakery": [
                "bread", "loaf", "sourdough", "baguette", "rolls", "bagel", "wrap", "tortilla", "tortilla wraps",
                "pitta", "pita", "naan", "croissant", "crumpet", "muffin", "brioche", "ciabatta", "focaccia", "bun",
                "scone", "teacake", "flatbread", "breadsticks",
            ],
            "Pantry": [
                "flour", "sugar", "rice", "pasta", "spaghetti", "penne", "fusilli", "linguine", "tagliatelle",
                "lasagne sheets", "noodles", "oil", "olive oil", "vinegar", "salt", "black pepper", "peppercorns",
                "stock", "stock cube", "chicken stock", "beef stock", "vegetable stock", "gravy", "tinned", "tin",
                "can", "chopped tomatoes", "tinned tomatoes", "passata", "tomato puree", "tomato paste", "beans",
                "baked beans", "butter beans", "chickpeas", "lentils", "kidney beans", "black beans", "coconut milk",
                "coconut cream", "soy sauce", "sauce", "fish sauce", "ketchup", "mayonnaise", "mayo", "mustard",
                "honey", "jam", "marmalade", "peanut butter", "cereal", "oats", "porridge", "granola", "crisps",
                "biscuits", "chocolate", "nuts", "almonds", "cashews", "walnuts", "peanuts", "seeds", "spice", "cumin",
                "paprika", "smoked paprika", "turmeric", "cinnamon", "oregano", "dried", "curry paste",
                "curry powder", "garam masala", "chilli flakes", "chilli powder", "couscous", "quinoa", "bulgur",
                "breadcrumbs", "panko", "cornflour", "baking powder", "bicarbonate", "yeast", "vanilla", "cocoa",
                "raisins", "sultanas", "tea", "teabags", "coffee", "syrup", "olives", "capers", "pesto", "crackers",
                "popcorn", "tahini", "miso", "sriracha", "worcestershire", "hoisin", "harissa", "lemon juice",
                "anchovies", "tuna chunks", "soup", "seasoning", "paste", "powder", "flakes", "sweetcorn",
                "tomato ketchup", "jelly", "stuffing", "tortilla chips", "lime juice",
            ],
            "Frozen": [
                "frozen", "ice cream", "ice", "fish fingers", "oven chips", "chips", "peas", "petits pois",
                "sorbet", "hash browns", "ice lollies",
            ],
            "Drinks": [
                "juice", "orange juice", "apple juice", "water", "sparkling water", "cola", "coke", "lemonade", "beer",
                "lager", "wine", "prosecco", "gin", "vodka", "whisky", "rum", "cider", "tonic", "smoothie",
                "kombucha", "fizzy", "cordial",
            ],
            "Cleaning": [
                "washing up liquid", "bin bags", "bin liners", "kitchen roll", "toilet roll", "foil", "cling film",
                "baking paper", "dishwasher tablets", "dishwasher salt", "laundry", "detergent", "fabric softener",
                "bleach", "sponges", "cleaner", "surface spray", "washing powder", "washing capsules", "rinse aid",
                "freezer bags",
            ],
            "Other": [
                "toothpaste", "toothbrush", "shampoo", "conditioner", "soap", "hand wash", "deodorant", "nappies",
                "wipes", "plasters", "batteries", "razors", "shower gel", "tissues", "cat food", "dog food",
                "cat litter", "paracetamol", "ibuprofen", "suncream", "flowers",
            ],
        ]
        return table.flatMap { aisle, words in words.map { ($0, aisle) } }
            // Same length, same answer every time: dictionaries have no order.
            .sorted { ($0.0.count, $0.0) > ($1.0.count, $1.0) }
    }()
}
