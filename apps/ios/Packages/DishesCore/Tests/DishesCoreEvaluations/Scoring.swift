// How close an answer is to the expected one, 0…1, and the rule that decides
// whether a job may start on the device (TODO_MOBILE.md, Phase D2, "close
// enough").

import Foundation
@testable import DishesCore

enum Score {
    static func normalise(_ s: String) -> String {
        s.lowercased().replacing(/[^\p{L}\p{N}\/.\- ]/, with: " ").split(separator: " ").joined(separator: " ")
    }

    static func words(_ s: String) -> Set<String> {
        Set(normalise(s).split(separator: " ").map { w in w.count > 3 && w.hasSuffix("s") ? String(w.dropLast()) : String(w) })
    }

    /// Shared words over all words.
    static func overlap(_ a: String, _ b: String) -> Double {
        let (x, y) = (words(a), words(b))
        if x.isEmpty && y.isEmpty { return 1 }
        return Double(x.intersection(y).count) / Double(x.union(y).count)
    }

    static func sameUnit(_ a: String, _ b: String) -> Bool {
        let strip = { (s: String) -> String in let n = normalise(s); return n.count > 2 && n.hasSuffix("s") ? String(n.dropLast()) : n }
        return strip(a) == strip(b)
    }

    static func sameAmount(_ a: String, _ b: String) -> Bool {
        normalise(a).replacingOccurrences(of: " ", with: "") == normalise(b).replacingOccurrences(of: " ", with: "")
    }

    /// One line's parts: a quarter each for amount, unit, name and preparation.
    static func line(_ got: GeneratedRecipe.Ingredient, _ want: IngredientEval.Parts) -> Double {
        var score = 0.0
        if sameAmount(got.amount, want.amount) { score += 0.25 }
        if sameUnit(got.unit, want.unit) { score += 0.25 }
        if overlap(got.ingredientName, want.name) == 1 { score += 0.25 }
        if overlap(got.preparation, want.preparation) == 1 { score += 0.25 }
        return score
    }

    /// A whole recipe: ingredients half of it (found, then right), the method
    /// three tenths, the title and the numbers the rest.
    static func recipe(_ got: GeneratedRecipe, _ want: GeneratedRecipe) -> Double {
        let title = overlap(got.title, want.title)

        var unmatched = Array(got.ingredients.indices)
        var found = 0.0, matched = 0
        for w in want.ingredients {
            guard let best = unmatched.max(by: { overlap(got.ingredients[$0].ingredientName, w.ingredientName)
                                                    < overlap(got.ingredients[$1].ingredientName, w.ingredientName) }),
                  overlap(got.ingredients[best].ingredientName, w.ingredientName) >= 0.5 else { continue }
            unmatched.removeAll { $0 == best }
            matched += 1
            let g = got.ingredients[best]
            found += 0.5 * overlap(g.ingredientName, w.ingredientName)
                + (sameAmount(g.amount, w.amount) ? 0.25 : 0) + (sameUnit(g.unit, w.unit) ? 0.25 : 0)
        }
        let recall = want.ingredients.isEmpty ? 1 : found / Double(want.ingredients.count)
        let precision = got.ingredients.isEmpty ? 0 : Double(matched) / Double(got.ingredients.count)
        let ingredients = 0.8 * recall + 0.2 * precision

        let counts = Double(min(got.steps.count, want.steps.count)) / Double(max(got.steps.count, want.steps.count, 1))
        let method = 0.5 * counts + 0.5 * overlap(got.steps.map(\.instruction).joined(separator: " "),
                                                  want.steps.map(\.instruction).joined(separator: " "))

        var numbers = sameAmount(got.servings, want.servings) ? 0.5 : 0
        if got.prepTimeMinutes == want.prepTimeMinutes { numbers += 0.25 }
        if got.cookTimeMinutes == want.cookTimeMinutes { numbers += 0.25 }

        return 0.1 * title + 0.5 * ingredients + 0.3 * method + 0.1 * numbers
    }
}

/// "Close enough" (James left it to D2; TODO_MOBILE.md): every sample passes
/// the structure checks, the score is at least 90% of the server's on the same
/// set, and at least 0.75 whatever the server scores.
struct Gate {
    static let floor = 0.75
    static let ofServer = 0.9

    var structurePassed: Int
    var samples: Int
    var deviceScore: Double
    var serverScore: Double?

    var passes: Bool {
        structurePassed == samples && deviceScore >= Self.floor
            && (serverScore.map { deviceScore >= Self.ofServer * $0 } ?? true)
    }

    var summary: String {
        let server = serverScore.map { String(format: "%.3f", $0) } ?? "not measured"
        return String(format: "structure %d/%d, device %.3f, server %@ → %@", structurePassed, samples, deviceScore, server,
                      passes ? "the device is close enough" : "stay on the server")
    }
}

/// The result kept in fixtures/evals/results/<job>.json, so the decision has a record.
struct EvalRecord: Codable {
    var job: String
    var date: Date
    var model: String
    var samples: Int
    var structurePassed: Int
    var deviceScore: Double
    var serverScore: Double?
    var serverIs: String
    var passes: Bool
    var perSample: [Sample]

    struct Sample: Codable {
        var name: String
        var deviceScore: Double
        var serverScore: Double?
        var engine: String
        var problems: [String]
        var seconds: Double
    }

    func save() throws {
        let folder = fixtureURL("evals/results")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(self).write(to: folder.appending(path: "\(job).json"))
    }
}

func fixtureURL(_ name: String) -> URL {
    URL(filePath: #filePath).deletingLastPathComponent()
        .appending(path: "../../../../../../fixtures/\(name)").standardized
}

/// Only with DISHES_EVALS=1, on macOS 27 with Apple Intelligence on.
var evaluationsWanted: Bool { ProcessInfo.processInfo.environment["DISHES_EVALS"] == "1" }
