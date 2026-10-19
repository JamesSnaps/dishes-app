// Autocomplete for the shopping list's add field, from what's already in the
// local store: every shopping item the household has had (the store holds all
// its lists, archived ones too) and the ingredient names in its recipes. No
// request per keystroke, and it works in a supermarket with no signal.
//
// The same rules as apps/web/lib/shopping-suggestions.ts — change one, change both.

import Foundation

public struct ShoppingSuggestion: Hashable, Sendable {
    public enum Source: Sendable { case history, recipe }

    /// As it was last written on a list (or in a recipe).
    public var name: String
    /// On a list before, or only in a recipe so far.
    public var source: Source
    /// Times on a list, or the number of recipes using it.
    public var count: Int
    /// The aisle it was last filed under, so picking it lands it there again.
    public var category: String?
}

public struct ShoppingSuggestionIndex: Sendable {
    struct Entry: Sendable {
        var suggestion: ShoppingSuggestion
        /// `ShoppingSuggestionIndex.key(name)`: what makes two rows the same item.
        var key: String
        /// The name lower-cased, for matching as typed.
        var text: String
        var score: Double
        var newest: Date
    }

    var entries: [Entry] = []
    /// Keys unticked on the active list — no point offering them again.
    public var onList: Set<String> = []

    public static let maxSuggestions = 6
    /// A list from two months ago counts half as much as one from today.
    static let halfLifeDays = 60.0

    public init() {}

    static func lower(_ name: String) -> String {
        name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            .split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    /// Case, spacing and a trailing plural "s" don't make a different item.
    public static func key(_ name: String) -> String {
        let k = lower(name)
        return k.count > 3 && k.hasSuffix("s") && !k.hasSuffix("ss") ? String(k.dropLast()) : k
    }

    static func parseDate(_ s: String) -> Date? {
        let withFraction = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
        return (try? withFraction.parse(s)) ?? (try? Date.ISO8601FormatStyle().parse(s))
    }

    /// One pass over the rows. `history` is shopping-item records; the newest
    /// decides a name's spelling and category, and each adds to its score,
    /// decayed by age. `recipes` is recipe records, for their ingredients.
    public init(history: [JSONValue], recipes: [JSONValue], now: Date = .now) {
        var byKey: [String: Entry] = [:]

        for row in history {
            guard let raw = row.string("ingredientName") else { continue }
            let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty else { continue }
            let key = Self.key(name)
            // An item added here that hasn't synced yet has no date: it's from now.
            let at = row.string("createdAt").flatMap(Self.parseDate) ?? now
            let ageDays = max(0, now.timeIntervalSince(at)) / 86_400
            let weight = pow(0.5, ageDays / Self.halfLifeDays)
            let category = row.string("category").flatMap { $0.isEmpty ? nil : $0 }

            guard var entry = byKey[key] else {
                byKey[key] = Entry(suggestion: ShoppingSuggestion(name: name, source: .history, count: 1, category: category),
                                   key: key, text: Self.lower(name), score: weight, newest: at)
                continue
            }
            entry.suggestion.count += 1
            entry.score += weight
            if at >= entry.newest {
                entry.newest = at
                entry.suggestion.name = name
                entry.text = Self.lower(name)
                if category != nil { entry.suggestion.category = category }
            } else if entry.suggestion.category == nil {
                entry.suggestion.category = category
            }
            byKey[key] = entry
        }

        for recipe in recipes {
            // A recipe that lists "salt" twice still only uses it once.
            var seen = Set<String>()
            for ingredient in recipe.array("ingredients") {
                guard let raw = ingredient.string("ingredientName") else { continue }
                let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !name.isEmpty else { continue }
                let key = Self.key(name)
                guard seen.insert(key).inserted else { continue }

                if var entry = byKey[key] {
                    if entry.suggestion.source == .recipe {
                        entry.suggestion.count += 1
                        byKey[key] = entry
                    }
                    continue
                }
                byKey[key] = Entry(suggestion: ShoppingSuggestion(name: name, source: .recipe, count: 1, category: nil),
                                   key: key, text: Self.lower(name), score: 0, newest: .distantPast)
            }
        }

        entries = Array(byKey.values)
    }

    /// Where the query matched: the start of the name, the start of a word, anywhere.
    static func tier(_ text: String, _ query: String) -> Int? {
        if text.hasPrefix(query) { return 0 }
        if text.contains(" " + query) { return 1 }
        // One letter matching mid-word is noise ("a" is in nearly everything).
        if query.count >= 2 && text.contains(query) { return 2 }
        return nil
    }

    /// The best few matches for what's been typed. Things bought before come
    /// ahead of things only seen in recipes, and among those the most bought
    /// (recently) first.
    public func suggestions(for typed: String, limit: Int = maxSuggestions) -> [ShoppingSuggestion] {
        let query = Self.lower(typed)
        guard !query.isEmpty else { return [] }
        let exact = Self.key(typed)

        var matches: [(entry: Entry, tier: Int)] = []
        for entry in entries where !onList.contains(entry.key) {
            // Exactly what was typed goes first, plural or not ("eggs" finds "Egg"):
            // picking it is the same as pressing Done, but it brings back the aisle.
            guard let tier = entry.key == exact ? -1 : Self.tier(entry.text, query) else { continue }
            matches.append((entry, tier))
        }

        matches.sort { a, b in
            if a.tier != b.tier { return a.tier < b.tier }
            let ah = a.entry.suggestion.source == .history, bh = b.entry.suggestion.source == .history
            if ah != bh { return ah }
            if a.entry.score != b.entry.score { return a.entry.score > b.entry.score }
            if a.entry.suggestion.count != b.entry.suggestion.count {
                return a.entry.suggestion.count > b.entry.suggestion.count
            }
            return a.entry.suggestion.name.localizedCompare(b.entry.suggestion.name) == .orderedAscending
        }
        return matches.prefix(limit).map(\.entry.suggestion)
    }

    /// Everything from the store, for `LocalStore.observe`.
    @Sendable public static func load(_ r: StoreReader) throws -> ShoppingSuggestionIndex {
        let history = try r.records(.shoppingItems)
        var index = ShoppingSuggestionIndex(history: history, recipes: try r.records(.recipes))
        let active = try r.records(.shoppingLists).first { $0.string("status") == "active" }?.id
        index.onList = Set(history.compactMap { row -> String? in
            let listId = row.string("listId")
            guard listId == active || listId == "pending", row.bool("isChecked") != true,
                  let name = row.string("ingredientName") else { return nil }
            return key(name)
        })
        return index
    }
}
