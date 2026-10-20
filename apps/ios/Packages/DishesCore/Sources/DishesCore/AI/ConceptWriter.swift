// Five recipe ideas on the device (TODO_MOBILE.md, D3): the concierge's first
// step (the server's `generateConcepts`, POST /api/v1/ai/concepts), from the
// cached AI context — who's eating, the taste profile, the household's
// settings — so it works offline. Writing the chosen idea out in full stays
// on the server, which also estimates its nutrition and files it.
//
//   let ideas = try await ConceptWriter.ideas(.init(prompt: "a cosy pasta dish"), context: AIContext.cached)
//   ConceptChecks.problems(ideas, eating: members)

import Foundation
import FoundationModels

public enum ConceptWriter {
    public struct Ask: Sendable {
        public var prompt: String
        public var memberIds: [String]
        public var mealType: String?
        public var heartHealthy: Bool
        public init(prompt: String, memberIds: [String] = [], mealType: String? = nil, heartHealthy: Bool = false) {
            self.prompt = prompt; self.memberIds = memberIds; self.mealType = mealType; self.heartHealthy = heartHealthy
        }
    }

    @available(iOS 27, macOS 27, *)
    public static func ideas(_ ask: Ask, context: AIContext?, year: Int = Calendar.current.component(.year, from: .now)) async throws -> [APIClient.Concept] {
        let eating = (context?.members ?? []).filter { ask.memberIds.contains($0.id) }
        let session = LanguageModelSession(instructions: Prompts.concepts(context, eating: eating, mealType: ask.mealType,
                                                                          heartHealthy: ask.heartHealthy, year: year))
        let list = try await session.respond(to: ask.prompt, generating: ConceptList.self).content
        return list.concepts.prefix(5).map {
            APIClient.Concept(title: $0.title.trimmingCharacters(in: .whitespaces),
                              description: $0.description.trimmingCharacters(in: .whitespaces),
                              cuisine: $0.cuisine.trimmingCharacters(in: .whitespaces),
                              tags: $0.tags.map { $0.lowercased().trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty },
                              difficulty: $0.difficulty)
        }
    }
}

/// What the device's ideas must get right before they're shown.
public enum ConceptChecks {
    /// Words that put meat or fish in a dish, for a vegetarian or vegan eating.
    static let meat = ["chicken", "beef", "pork", "lamb", "bacon", "ham", "prawn", "shrimp", "fish", "salmon", "tuna", "cod",
                       "haddock", "mackerel", "chorizo", "sausage", "steak", "turkey", "duck", "anchov", "pancetta", "guanciale",
                       "prosciutto", "salami", "pepperoni", "venison", "mince", "meatball", "crab", "mussel", "squid", "scallop"]
    static let animal = ["egg", "cheese", "butter", "cream", "milk", "yoghurt", "yogurt", "honey", "feta", "parmesan",
                         "mozzarella", "halloumi", "paneer", "ricotta", "mascarpone", "ghee"]

    /// The word at a word's start ("ham" isn't in "shame"), and not a stand-in
    /// for it ("vegan cheese", "veggie mince").
    static func mentions(_ text: String, _ word: String) -> Bool {
        let lower = text.lowercased()
        let w = word.lowercased().trimmingCharacters(in: .whitespaces)
        let stem = w.count > 4 && w.hasSuffix("s") ? String(w.dropLast()) : w
        guard !stem.isEmpty else { return false }
        for r in lower.ranges(of: stem) {
            let head = lower[..<r.lowerBound]
            if head.last?.isLetter == true { continue }
            if ["vegan ", "veggie ", "plant-based ", "plant ", "meat-free ", "vegetarian ", "dairy-free ", "no "].contains(where: head.hasSuffix) { continue }
            return true
        }
        return false
    }

    public static func problems(_ ideas: [APIClient.Concept], eating: [AIContext.Member]) -> [String] {
        var out: [String] = []
        if ideas.count != 5 { out.append("\(ideas.count) ideas, not five") }
        if Set(ideas.map { $0.title.lowercased() }).count != ideas.count { out.append("the same idea twice") }
        if ideas.contains(where: { $0.title.isEmpty || $0.description.isEmpty }) { out.append("an idea with no title or description") }
        if let bad = ideas.first(where: { !RecipeChecks.difficulties.contains($0.difficulty) }) { out.append("difficulty “\(bad.difficulty)”") }
        let flags = Set(eating.flatMap(\.dietaryFlags).map { $0.lowercased() })
        let text = { (c: APIClient.Concept) in "\(c.title) \(c.description)" }
        if flags.contains(where: { $0.contains("vegetarian") || $0.contains("vegan") }),
           let bad = ideas.first(where: { c in meat.contains { mentions(text(c), $0) } }) {
            out.append("“\(bad.title)” for a vegetarian")
        }
        if flags.contains(where: { $0.contains("vegan") }), let bad = ideas.first(where: { c in animal.contains { mentions(text(c), $0) } }) {
            out.append("“\(bad.title)” for a vegan")
        }
        for dislike in eating.flatMap(\.dislikes) where !dislike.isEmpty {
            if let bad = ideas.first(where: { mentions(text($0), dislike) }) { out.append("“\(bad.title)” has \(dislike), which someone dislikes") }
        }
        return out
    }
}

// MARK: What the model writes

@available(iOS 27, macOS 27, *)
@Generable
struct ConceptList {
    @Guide(description: "Exactly five distinct recipe concepts", .count(5))
    var concepts: [ConceptDraft]
}

@available(iOS 27, macOS 27, *)
@Generable
struct ConceptDraft {
    @Guide(description: "The dish's name")
    var title: String
    @Guide(description: "One or two sentences on the dish")
    var description: String
    @Guide(description: "The cuisine, e.g. \"Italian\"")
    var cuisine: String
    @Guide(description: "A few short tags, e.g. \"quick\" or \"vegetarian\"", .maximumCount(4))
    var tags: [String]
    @Guide(.anyOf(["easy", "medium", "hard"]))
    var difficulty: String
}
