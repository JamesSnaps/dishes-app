// Finds the ingredients a step's text mentions, the way the web's cooking mode
// does (cooking-mode.tsx, StepText): full names first ("celery sticks"),
// single-word names in either number ("onion" / "onions"), then a name's head
// noun on its own ("rice" for "basmati rice") when no other ingredient claims
// it. Steps saved before step→ingredient links existed, and recipes from the
// web editor, have no links — this is what highlights them.
//
//   let match = StepMatch(instruction, candidates: ingredients)
//   Text(match.highlighted(color: Theme.brandDeep)); match.ids

import DishesCore
import Foundation
import SwiftUI

struct StepMatch {
    /// Ranges of the instruction that name an ingredient, with which one.
    let spans: [(range: Range<String.Index>, id: String)]
    let instruction: String

    var ids: Set<String> { Set(spans.map(\.id)) }

    init(_ instruction: String, candidates: [Ingredient]) {
        self.instruction = instruction
        var byForm: [String: String] = [:]   // lowercased surface form → ingredient id
        var patterns: [String] = []
        let named = candidates.filter { !$0.name.isEmpty }.sorted { $0.name.count > $1.name.count }

        for ingredient in named {
            let name = ingredient.name.lowercased()
            if name.contains(" ") || name.contains("-") {
                if byForm[name] == nil { byForm[name] = ingredient.id; patterns.append(name) }
            } else {
                for form in Self.forms(name) where byForm[form] == nil {
                    byForm[form] = ingredient.id
                    patterns.append(form)
                }
            }
        }

        // Head nouns, then other words, that only one ingredient claims.
        var claims: [String: (id: String?, head: Bool)] = [:]
        for ingredient in named {
            let words = ingredient.name.lowercased().split(whereSeparator: { " -,".contains($0) }).map(String.init)
            for (index, word) in words.enumerated() {
                let key = Self.singular(word)
                guard word.count >= 3, !Self.modifiers.contains(word), byForm[key] == nil else { continue }
                let head = index == words.count - 1
                if let existing = claims[key] {
                    if existing.head == head, existing.id != ingredient.id { claims[key] = (nil, head) }
                    else if head && !existing.head { claims[key] = (ingredient.id, true) }
                } else {
                    claims[key] = (ingredient.id, head)
                }
            }
        }
        for (key, claim) in claims {
            guard let id = claim.id else { continue }
            for form in Self.forms(key) where byForm[form] == nil {
                byForm[form] = id
                patterns.append(form)
            }
        }

        guard !patterns.isEmpty else { spans = []; return }
        // Longest first, so "red onion" wins over "onion".
        let alternation = patterns.sorted { $0.count > $1.count }.map(NSRegularExpression.escapedPattern(for:)).joined(separator: "|")
        guard let regex = try? NSRegularExpression(pattern: "\\b(?:\(alternation))\\b", options: [.caseInsensitive]) else {
            spans = []
            return
        }
        let ns = NSRange(instruction.startIndex..., in: instruction)
        spans = regex.matches(in: instruction, range: ns).compactMap { match in
            guard let range = Range(match.range, in: instruction),
                  let id = byForm[instruction[range].lowercased()] else { return nil }
            return (range, id)
        }
    }

    /// The instruction with the matched names emphasised.
    func highlighted(color: Color) -> AttributedString {
        var text = AttributedString(instruction)
        for span in spans {
            guard let lower = AttributedString.Index(span.range.lowerBound, within: text),
                  let upper = AttributedString.Index(span.range.upperBound, within: text) else { continue }
            text[lower..<upper].foregroundColor = color
            text[lower..<upper].inlinePresentationIntent = .stronglyEmphasized
        }
        return text
    }

    /// The instruction as one Text, each name bold and dotted-underlined (the
    /// web's tooltip chips) and tagged with `IngredientTag`, so a tap can be
    /// traced back to its ingredient through the text's layout.
    func text(color: Color) -> Text {
        var pieces: [Text] = []
        var cursor = instruction.startIndex
        for span in spans where span.range.lowerBound >= cursor {
            if cursor < span.range.lowerBound { pieces.append(Text(instruction[cursor..<span.range.lowerBound])) }
            pieces.append(Text(instruction[span.range])
                .bold()
                .foregroundStyle(color)
                .underline(pattern: .dot, color: color.opacity(0.7))
                .customAttribute(IngredientTag(id: span.id)))
            cursor = span.range.upperBound
        }
        if cursor < instruction.endIndex { pieces.append(Text(instruction[cursor...])) }
        return pieces.reduce(Text(verbatim: "")) { Text("\($0)\($1)") }
    }

    private static let modifiers: Set<String> = [
        "long", "grain", "short", "fresh", "frozen", "dried", "raw", "cooked", "large", "small", "medium",
        "fine", "coarse", "chopped", "diced", "sliced", "minced", "grated", "beaten", "rinsed", "thawed",
        "peeled", "whole", "lean", "plain", "dark", "light", "extra", "young", "baby", "mixed", "taste",
        "and", "or", "the", "for", "with", "hot", "cut", "low", "cup", "can", "jar", "tin",
    ]

    /// A word's canonical singular, applied the same way to both sides.
    static func singular(_ word: String) -> String {
        let w = word.lowercased()
        if w.hasSuffix("ies"), w.count > 4 { return String(w.dropLast(3)) + "y" }
        if ["ches", "shes", "ses", "xes", "zes"].contains(where: w.hasSuffix) { return String(w.dropLast(2)) }
        if w.hasSuffix("ss") { return w }
        if w.hasSuffix("s"), w.count > 3 { return String(w.dropLast()) }
        return w
    }

    /// The word, its singular, and a plausible plural.
    static func forms(_ word: String) -> [String] {
        let w = word.lowercased()
        var forms: [String] = [w, singular(w)]
        if let last = w.last, last == "y", let before = w.dropLast().last, !"aeiou".contains(before) {
            forms.append(String(w.dropLast()) + "ies")
        } else if ["s", "x", "z", "ch", "sh"].contains(where: w.hasSuffix) {
            forms.append(w + "es")
        } else {
            forms.append(w + "s")
        }
        return Array(Set(forms))
    }
}

/// Marks an ingredient's name in a step's Text (see `StepMatch.text`).
struct IngredientTag: TextAttribute {
    let id: String
}

extension Text.Layout {
    /// The ingredient whose name is under `point`, and that name's frame.
    func ingredient(at point: CGPoint) -> (id: String, frame: CGRect)? {
        for line in self {
            for run in line {
                guard let tag = run[IngredientTag.self] else { continue }
                let rect = run.typographicBounds.rect.insetBy(dx: -6, dy: -6)
                if rect.contains(point) { return (tag.id, run.typographicBounds.rect) }
            }
        }
        return nil
    }
}
