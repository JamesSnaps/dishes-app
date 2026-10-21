// What someone said to cooking mode with their hands full (TODO_MOBILE.md, C4
// "Hands-free cooking"), from the on-device transcriber's text. Only short,
// plain commands count, so talk in the kitchen doesn't turn the page:
//
//   "next" / "next step"              → .next
//   "back" / "previous step"          → .back
//   "read it" / "say that again"      → .read
//   "start the timer"                 → .startTimer
//   "how much butter?"                → .howMuch("butter")
//
//   if case .howMuch(let what)? = CookCommand(heard), let n = CookCommand.ingredient(matching: what, in: names) { … }

import Foundation

public enum CookCommand: Equatable, Sendable {
    case next, back, read, startTimer
    case howMuch(String)

    /// The words a navigation command may have around it at most.
    static let maxWords = 5

    public init?(_ heard: String) {
        let text = heard.lowercased()
            .replacing(/[^\p{L}\p{N}' ]/, with: " ")
            .split(separator: " ").joined(separator: " ")
        guard !text.isEmpty else { return nil }

        if let m = text.firstMatch(of: /^(?:ok |okay |so )?how (?:much|many) (?:of )?(?:the )?(.+?)(?: do i (?:need|use|add)| is it| goes in| in this step| for this)?$/) {
            let what = String(m.1).trimmingCharacters(in: .whitespaces)
            guard !what.isEmpty, what != "time", what != "longer" else { return nil }
            self = .howMuch(what)
            return
        }
        let words = text.split(separator: " ").map(String.init)
        guard words.count <= Self.maxWords else { return nil }
        let has = { (w: String) in words.contains(w) }
        if text.contains("timer") && (has("start") || has("set") || words.count <= 2) {
            self = .startTimer
        } else if has("next") || text.contains("go on") || text.contains("carry on") {
            self = .next
        } else if has("back") || has("previous") || text.contains("last step") {
            self = .back
        } else if has("read") || has("repeat") || has("again") || text.contains("what's this step") || text.contains("what was that") {
            self = .read
        } else {
            return nil
        }
    }

    /// Which ingredient "butter" or "the onions" means: the name sharing the
    /// most words with it (plurals forgiven), nil when none share any.
    public static func ingredient(matching phrase: String, in names: [String]) -> Int? {
        func words(_ s: String) -> Set<String> {
            Set(s.lowercased().split(whereSeparator: { !$0.isLetter }).map { w in
                let w = String(w)
                return w.count > 3 && w.hasSuffix("es") ? String(w.dropLast(2)) : w.count > 3 && w.hasSuffix("s") ? String(w.dropLast()) : w
            }.filter { $0.count > 2 && !["the", "and", "some", "any"].contains($0) })
        }
        let wanted = words(phrase)
        guard !wanted.isEmpty else { return nil }
        let scored = names.enumerated().map { ($0.offset, words($0.element).intersection(wanted).count) }
        guard let best = scored.max(by: { $0.1 < $1.1 }), best.1 > 0 else { return nil }
        return best.0
    }
}
