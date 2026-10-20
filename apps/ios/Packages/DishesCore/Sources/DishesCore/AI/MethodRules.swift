// A pasted recipe split into ingredient lines and method steps, by rules —
// the Swift twin of `looksLikeInstruction`, `splitIngredientsText` and
// `parseStepsText` (apps/web/lib/recipe-parser.ts), which the server's paste
// import (`import.parse`) uses. Change a rule there and here together.
//
// Here the ingredient lines then go through IngredientLineReader, so the
// on-device model can tidy the ones the rules misread; the server keeps the
// rules' answer.

import Foundation

public enum MethodRules {
    static let instructionCues: Set<String> = [
        "add", "allow", "arrange", "bake", "beat", "blend", "boil", "bring", "brush",
        "chill", "chop", "churn", "combine", "continue", "cook", "cover", "cut",
        "discard", "divide", "drain", "drizzle", "dust", "finally", "fold", "freeze",
        "fry", "garnish", "grease", "grill", "heat", "knead", "leave", "let", "line",
        "meanwhile", "mix", "next", "once", "place", "pour", "preheat", "process",
        "pulse", "reduce", "refrigerate", "remove", "repeat", "return", "roast",
        "scoop", "seal", "season", "serve", "set", "sift", "simmer", "slice",
        "spoon", "spread", "sprinkle", "stir", "strain", "then", "top", "toss",
        "transfer", "turn", "warm", "when", "whisk", "while", "wrap",
    ]

    /// Does this line read like a method instruction rather than an ingredient?
    public static func looksLikeInstruction(_ line: String) -> Bool {
        let cleaned = line.trimmingCharacters(in: .whitespaces)
            .replacing(/^[-–•*·]\s*/, with: "")
            .replacing(/(?i)^(?:step\s*)?[0-9]+\s*[.):\-–]\s*/, with: "")
        guard !cleaned.isEmpty else { return false }
        let words = cleaned.split(whereSeparator: \.isWhitespace)
        let first = words[0].lowercased().filter { $0.isLetter && $0.isASCII }
        if instructionCues.contains(first) { return true }
        // More than one sentence on the line is prose, not an ingredient.
        if cleaned.contains(/[.!?]\s+[A-Z]/) { return true }
        // Long lines without a leading amount are almost always instructions.
        if words.count >= 12, cleaned.prefixMatch(of: IngredientRules.amount) == nil { return true }
        return false
    }

    /// The ingredient lines of a paste, and whatever looked like method.
    public static func splitIngredients(_ text: String) -> (lines: [String], leftover: String) {
        var lines: [String] = [], leftover: [String] = []
        for raw in text.split(separator: "\n", omittingEmptySubsequences: true) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            guard !line.isEmpty else { continue }
            if looksLikeInstruction(line) { leftover.append(line) } else { lines.append(line) }
        }
        return (lines, leftover.joined(separator: "\n"))
    }

    /// A method as numbered steps, bullets, paragraphs or lines.
    public static func steps(_ text: String) -> [GeneratedRecipe.Step] {
        let step = { (s: Substring) in
            GeneratedRecipe.Step(instruction: s.split(whereSeparator: \.isWhitespace).joined(separator: " "))
        }
        let numbered = /(?i)(?:^|\n)\s*(?:step\s*)?[0-9]+[.):\-–]\s*/
        if text.contains(numbered) {
            return text.split(separator: /(?i)\n?\s*(?:step\s*)?[0-9]+[.):\-–]\s*/)
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
                .map { step(Substring($0)) }
        }
        if text.contains(/(?m)^[-–•*]\s+/) {
            return text.split(separator: /\n(?=[-–•*]\s)/)
                .map { $0.replacing(/^[-–•*]\s+/, with: "").trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }.map { step(Substring($0)) }
        }
        let paragraphs = text.split(separator: /\n\n+/).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        if paragraphs.count > 1 { return paragraphs.map { step(Substring($0)) } }
        return text.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.map { step(Substring($0)) }
    }
}
