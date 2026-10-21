// An ingredient line read by rules, with no model: the Swift twin of
// `parseIngredientLine` (apps/web/lib/recipe-parser.ts) and the extras the web
// import adds in `parseIngredientLines` (apps/web/lib/recipe-web-import.ts) —
// vulgar fractions, ranges, "100g/3½oz", "2 x 400g tins". Change a rule there
// and here together: fixtures/ingredient-lines.json's `rules` answers are
// checked against both (IngredientRulesTests, scripts/check-ai-context.ts).
//
// The rules are instant and offline but literal: "2 tbsp finely chopped
// parsley" gives the name "finely chopped parsley". `IngredientRules.isUnsure`
// says when a line is worth a second read by the on-device model
// (IngredientLineReader).
//
//   IngredientRules.parse("400 g tin chopped tomatoes, drained")

import Foundation

public enum IngredientRules {
    /// Longest first, so "tablespoons" is found before "tablespoon" and "tbsp".
    static let units = [
        "fl oz", "fl. oz",
        "tablespoons", "tablespoon", "teaspoons", "teaspoon",
        "kilograms", "kilogram", "milligrams", "milligram",
        "millilitres", "milliliters", "millilitre", "milliliter",
        "litres", "liters", "litre", "liter",
        "ounces", "ounce", "pounds", "pound", "gallons", "gallon", "quarts", "quart", "pints", "pint",
        "pinches", "pinch", "dashes", "dash", "handfuls", "handful", "bunches", "bunch", "sprigs", "sprig",
        "cloves", "clove", "heads", "head", "slices", "slice", "sheets", "sheet", "sticks", "stick",
        "pieces", "piece", "sachets", "sachet", "packets", "packet", "bottles", "bottle", "cans", "can",
        "jars", "jar", "bags", "bag", "boxes", "box", "tins", "tin", "cups", "cup",
        "tbsp", "tsp", "kg", "mg", "ml", "dl", "lb", "lbs", "oz", "pt", "qt", "gl", "g", "l", "c", "t",
    ]

    /// Mixed fraction (1 1/2), fraction (1/2), decimal (2.5), integer (3).
    /// `[0-9]`, not `\d`, throughout: Swift's `\d` matches any Unicode digit
    /// (½ included), JavaScript's only 0–9, and these rules must read as the web's do.
    nonisolated(unsafe) static let amount = /^([0-9]+\s+[0-9]+\/[0-9]+|[0-9]+\/[0-9]+|[0-9]+(?:\.[0-9]+)?)\s*/

    static let vulgarFractions: [Character: String] = [
        "½": "1/2", "⅓": "1/3", "⅔": "2/3", "¼": "1/4", "¾": "3/4", "⅕": "1/5", "⅖": "2/5", "⅗": "3/5",
        "⅘": "4/5", "⅙": "1/6", "⅚": "5/6", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
    ]

    /// One line, as the server's `parseIngredientLine` reads it. nil for a blank line.
    public static func parseLine(_ raw: String) -> GeneratedRecipe.Ingredient? {
        var line = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !line.isEmpty else { return nil }
        line = line.replacing(/^[-–•*·]\s*/, with: "")

        let isOptional = line.contains(/(?i)\(\s*optional\s*\)/) || line.contains(/(?i)^optional[:\s]/)
        line = line.replacing(/(?i)\s*\(\s*optional\s*\)/, with: "").trimmingCharacters(in: .whitespaces)

        var amount = "", unit = ""
        var rest = Substring(line)
        if let match = rest.prefixMatch(of: Self.amount) {
            amount = String(match.1).trimmingCharacters(in: .whitespaces)
            rest = rest[match.range.upperBound...]
            let lower = rest.lowercased()
            for u in units where lower.hasPrefix(u) {
                // A whole word: followed by a space, comma, full stop or the end.
                let after = lower.dropFirst(u.count).first
                guard after == nil || after == " " || after == "," || after == "." else { continue }
                unit = u
                rest = rest.dropFirst(u.count)
                let trimmed = rest.drop { $0.isWhitespace }
                // "2 cups of flour" — the name is "flour".
                rest = trimmed.lowercased().hasPrefix("of ") ? trimmed.dropFirst(3) : trimmed
                break
            }
        }

        let name: String, preparation: String
        if let comma = rest.firstIndex(of: ",") {
            name = rest[..<comma].trimmingCharacters(in: .whitespaces)
            preparation = rest[rest.index(after: comma)...].trimmingCharacters(in: .whitespaces)
        } else {
            name = rest.trimmingCharacters(in: .whitespaces)
            preparation = ""
        }
        guard !name.isEmpty else { return nil }
        return .init(ingredientName: name, amount: amount, unit: unit, preparation: preparation, isOptional: isOptional)
    }

    /// "1½ tsp" → "1 1/2 tsp", so the amount pattern sees it.
    public static func normaliseFractions(_ s: String) -> String {
        var out = ""
        for ch in s {
            if let f = vulgarFractions[ch] {
                // "1½" → "1 1/2"; "1 ½" already has its space.
                if out.last?.isNumber == true { out += " " }
                out += f
            } else {
                out.append(ch)
            }
        }
        return out.replacing(/([0-9])⁄([0-9])/) { "\($0.1)/\($0.2)" }
    }

    /// Lines → rows, as the web import reads a recipe page's list: headings
    /// ("For the sauce:") become the group label of the lines after them.
    public static func parseLines(_ lines: [String]) -> [GeneratedRecipe.Ingredient] {
        var out: [GeneratedRecipe.Ingredient] = []
        var group = ""
        for raw in lines {
            // UK sites print both systems: "100g/3 1/2oz butter" → "100g butter".
            let line = normaliseFractions(raw).replacing(
                /(?i)^([0-9]+(?:\.[0-9]+)?\s*(?:g|kg|ml|l|cm))\s*\/(?:\s*[[0-9]\s\/.]+\s*(?:fl\.?\s?oz|oz|lbs?|pints?|pt|cups?|in)\b)+/
            ) { String($0.1) }
            if let heading = heading(line) {
                group = heading
                continue
            }
            // A range ("1-2 lemons", "3 to 4 tbsp oil") keeps both ends as the amount.
            let range = line.prefixMatch(of: /(?i)^([0-9]+(?:\.[0-9]+)?)\s*(?:-|–|to)\s*([0-9]+(?:\.[0-9]+)?)\s*(?=\D)/)
            let parsed = range.map { parseLine("1 " + line[$0.range.upperBound...]) } ?? parseLine(line)
            guard var parsed else { continue }
            if let range { parsed.amount = "\(range.1)-\(range.2)" }
            // "2 x 400g tins chopped tomatoes": two of the "400g tins…".
            parsed.ingredientName = parsed.ingredientName.replacing(/(?i)^x\s+/, with: "")
            parsed.groupLabel = group
            out.append(parsed)
        }
        return out
    }

    public static func parse(_ line: String) -> GeneratedRecipe.Ingredient? { parseLines([line]).first }

    /// A quantity as printed → amount and unit: "250g" → 250 · g, "2 tbsp" →
    /// 2 · tbsp, "4" → 4 · "", "6 rashers" → 6 · rashers. A word the unit list
    /// doesn't know is kept as the unit only when it's the one word left.
    public static func splitQuantity(_ raw: String) -> (amount: String, unit: String) {
        let text = normaliseFractions(raw).trimmingCharacters(in: .whitespaces)
        guard let match = text.prefixMatch(of: amount) else { return ("", "") }
        let amount = String(match.1).trimmingCharacters(in: .whitespaces)
        let rest = text[match.range.upperBound...].trimmingCharacters(in: .whitespaces).lowercased()
        let range = text.prefixMatch(of: /(?i)^([0-9]+(?:\.[0-9]+)?)\s*(?:-|–|to)\s*([0-9]+(?:\.[0-9]+)?)\s*/)
        let value = range.map { "\($0.1)-\($0.2)" } ?? amount
        let unitText = range.map { text[$0.range.upperBound...].trimmingCharacters(in: .whitespaces).lowercased() } ?? rest
        if let unit = units.first(where: { unitText == $0 || unitText == $0 + "." }) { return (value, unit) }
        let words = unitText.split(separator: " ")
        return (value, words.count == 1 && words[0].allSatisfy(\.isLetter) ? String(words[0]) : "")
    }

    /// "For the sauce:" → "For the sauce"; nil for any other line.
    public static func heading(_ line: String) -> String? {
        let line = line.trimmingCharacters(in: .whitespaces)
        guard line.wholeMatch(of: /(?i)^(?:for\s+the\s+)?(.{2,40}?):$/) != nil, !line.contains(/[0-9]/) else { return nil }
        return String(line.dropLast()).trimmingCharacters(in: .whitespaces)
    }

    // MARK: When to ask the model

    /// Words that start a preparation, not a name: "finely chopped parsley".
    static let preparationWords: Set<String> = [
        "finely", "roughly", "thinly", "coarsely", "freshly", "chopped", "diced", "sliced", "grated", "minced",
        "crushed", "peeled", "deseeded", "halved", "quartered", "shredded", "softened", "melted", "beaten",
        "toasted", "drained", "rinsed", "trimmed", "cubed", "zested", "juiced", "torn", "picked", "sifted",
    ]

    /// The rules read the line, but likely not the way a cook would. Worth the
    /// model's second opinion when it's there; the rules' answer stands when not.
    public static func isUnsure(_ line: String, _ parsed: GeneratedRecipe.Ingredient?) -> Bool {
        guard let parsed else { return !line.trimmingCharacters(in: .whitespaces).isEmpty }
        let words = parsed.ingredientName.lowercased().split(whereSeparator: { !$0.isLetter && $0 != "-" }).map(String.init)
        // Packs and tins name the product as sold: "tin chopped tomatoes", "2 x 400g tins chickpeas".
        let packaged = words.contains { ["tin", "tins", "can", "cans", "jar", "jars", "pack", "packs", "packet", "carton"].contains($0) }
            || ["tin", "tins", "can", "cans", "jar", "jars"].contains(parsed.unit)
        let multiple = line.contains(/(?i)^\s*[0-9]+\s*x\s+/)
        // Preparation in front of the name, with no comma to split it off.
        if parsed.preparation.isEmpty, !packaged, words.contains(where: preparationWords.contains) { return true }
        // A number left in the name: "chicken thighs (about 600g)", "juice of 2 lemons".
        if parsed.ingredientName.contains(/[0-9]/), !multiple { return true }
        // An amount written as words: "a handful of rocket", "half an onion", "pinch of salt".
        if parsed.amount.isEmpty, let first = words.first,
           ["a", "an", "one", "two", "three", "four", "half", "some", "few", "couple",
            "pinch", "dash", "splash", "knob", "drizzle", "handful", "juice", "zest"].contains(first) { return true }
        // A bracket the comma rule doesn't split: "tomatoes (ripe)".
        if parsed.ingredientName.contains("(") { return true }
        return false
    }
}
