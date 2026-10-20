// "2 tbsp finely chopped parsley" → 2 · tbsp · parsley · finely chopped, as
// you type, offline (TODO_MOBILE.md, Phase D2 and D3). The rules
// (IngredientRules) read every line instantly; only a line they're unsure of
// goes to the on-device model, and its answer is kept only if it passes
// IngredientChecks. Otherwise — or with no Apple Intelligence — the rules'
// answer stands, as on the server, which reads pasted lines with the same rules.
//
//   let rows = await IngredientLineReader.read(pastedText.split(separator: "\n").map(String.init))

import Foundation
import FoundationModels

public enum IngredientLineReader {
    /// One line. nil for a blank line or a heading.
    public static func read(_ line: String) async -> AIRun<GeneratedRecipe.Ingredient>? {
        await read([line]).first
    }

    /// Lines in order, with headings ("For the sauce:") as the group label of
    /// the lines after them, as the rules give it.
    public static func read(_ lines: [String]) async -> [AIRun<GeneratedRecipe.Ingredient>] {
        var out: [AIRun<GeneratedRecipe.Ingredient>] = []
        var group = ""
        for line in lines {
            // The rules read headings and groups; one line at a time, so each row knows its own line.
            let before = IngredientRules.parseLines([line])
            guard var ruled = before.first else {
                if let heading = IngredientRules.heading(line) { group = heading }
                continue
            }
            ruled.groupLabel = group
            guard IngredientRules.isUnsure(line, ruled) else {
                out.append(AIRun(value: ruled, engine: .rules))
                continue
            }
            let fixed = ruled
            let run = try? await AIRouter.run(
                .ingredientLine,
                onDevice: {
                    guard #available(iOS 27, macOS 27, *) else { throw DeviceAIUnavailable() }
                    var parts = try await modelRead(line)
                    parts.isOptional = fixed.isOptional
                    parts.groupLabel = fixed.groupLabel
                    return parts
                },
                check: { IngredientChecks.problems($0, line: line) },
                fallback: { fixed })
            out.append(run ?? AIRun(value: ruled, engine: .rules))
        }
        return out
    }

    @available(iOS 27, macOS 27, *)
    static func modelRead(_ line: String) async throws -> GeneratedRecipe.Ingredient {
        let session = LanguageModelSession(instructions: Prompts.readIngredientLine)
        let parts = try await session.respond(to: line, generating: IngredientParts.self).content
        return GeneratedRecipe.Ingredient(ingredientName: parts.name.trimmingCharacters(in: .whitespaces),
                                          amount: parts.amount.trimmingCharacters(in: .whitespaces),
                                          unit: parts.unit.trimmingCharacters(in: .whitespaces),
                                          preparation: parts.preparation.trimmingCharacters(in: .whitespaces))
    }
}

struct DeviceAIUnavailable: Error {}

@available(iOS 27, macOS 27, *)
@Generable(description: "One ingredient line split into its parts")
struct IngredientParts {
    /// A number, fraction or range, or nothing (the same shape IngredientChecks.isAmount accepts).
    /// Guides take `\d` and `\w` but no character classes (`[0-9]` is "an
    /// unsupported generation guide"), so this is the one place `\d` stays.
    @Guide(/(?:\d+(?:\.\d+)?(?: \d+\/\d+)?|\d+\/\d+|\d+(?:\.\d+)?-\d+(?:\.\d+)?)?/)
    var amount: String
    @Guide(description: "The measure, e.g. \"g\", \"tbsp\", \"pinch\", \"handful\"; empty if the amount counts the ingredient itself")
    var unit: String
    @Guide(description: "The ingredient itself, without its amount, unit or preparation")
    var name: String
    @Guide(description: "What is done to it, e.g. \"finely chopped\" or \"juiced\"; empty if nothing")
    var preparation: String
}
