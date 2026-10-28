import Foundation

/// "Help me choose": dishes the household's AI suggests from a menu for each
/// person eating (POST /api/v1/outside-meals/menu-picks; lib/ai/menu-picks.ts
/// on the web). Nothing is saved: picking some fills in the log sheet.
public struct MenuPicks: Decodable, Hashable, Sendable {
    public struct Restaurant: Decodable, Hashable, Sendable {
        public var name: String?
        public var cuisine: String?
    }

    public struct Pick: Decodable, Hashable, Sendable {
        public var dish: String
        /// "starter", "main", "side", "dessert" or "drink".
        public var course: String
        /// The dish's line from the menu, word for word.
        public var menuLine: String
        /// Printed on the menu; nil when it isn't.
        public var menuKcal: Int?
        /// The AI's rough figure when nothing's printed.
        public var estimatedKcal: Int?
        public var why: String
        public var lighterTweak: String?

        public var courseKind: OutsideMeal.Course.Kind { OutsideMeal.Course.Kind(rawValue: course) ?? .main }

        /// "720 kcal on the menu", "about 650 kcal (estimate)", or nil.
        public var kcalText: String? {
            if let menuKcal { return "\(menuKcal) kcal on the menu" }
            if let estimatedKcal { return "about \(estimatedKcal) kcal (estimate)" }
            return nil
        }
    }

    public struct Avoid: Decodable, Hashable, Sendable {
        public var dish: String
        public var why: String
    }

    public struct Diner: Decodable, Hashable, Sendable, Identifiable {
        public var name: String
        public var picks: [Pick]
        public var avoid: [Avoid]
        public var id: String { name }
    }

    public var date: String
    public var restaurant: Restaurant
    public var diners: [Diner]
    public var note: String?

    /// A pick that was ticked, with whose it was.
    public struct Chosen: Hashable, Sendable {
        public var diner: String
        public var pick: Pick
        public init(diner: String, pick: Pick) { self.diner = diner; self.pick = pick }
    }

    /// What the ticked picks put on the log sheet — the web sheet's
    /// `applyChoice`. One dish fills in the dish and its menu line; several
    /// become courses in eating order. A plan keeps only the names (its menu
    /// fields aren't on the form). Whoever they were for are the ones eating:
    /// everyone ticked is `eatenBy` empty, which means everyone.
    public struct Applied: Equatable, Sendable {
        public var title: String
        public var menuText: String
        public var menuKcal: String
        public var courses: [(kind: OutsideMeal.Course.Kind, text: String, kcal: String)]
        public var eatenBy: [String]
        /// Only when the sheet's "where" is empty.
        public var place: String?

        public static func == (a: Applied, b: Applied) -> Bool {
            a.title == b.title && a.menuText == b.menuText && a.menuKcal == b.menuKcal && a.eatenBy == b.eatenBy
                && a.place == b.place && a.courses.count == b.courses.count
                && zip(a.courses, b.courses).allSatisfy { $0.kind == $1.kind && $0.text == $1.text && $0.kcal == $1.kcal }
        }
    }

    public func apply(_ chosen: [Chosen], everyone: [String], isPlan: Bool, placeIsEmpty: Bool) -> Applied {
        let who = chosen.map(\.diner).reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
        let eatenBy = Set(who).isSuperset(of: everyone) ? [] : who
        let place = placeIsEmpty ? restaurant.name.map { String($0.prefix(200)) } : nil
        let kcal = { (p: Pick) in p.menuKcal.map(String.init) ?? "" }

        if isPlan {
            let title = String(chosen.map(\.pick.dish).joined(separator: ", ").prefix(200))
            return Applied(title: title, menuText: "", menuKcal: "", courses: [], eatenBy: eatenBy, place: place)
        }
        if chosen.count == 1, let p = chosen.first?.pick {
            return Applied(title: String(p.dish.prefix(200)), menuText: p.menuLine, menuKcal: kcal(p), courses: [],
                           eatenBy: eatenBy, place: place)
        }
        let order = OutsideMeal.Course.Kind.allCases
        let courses = chosen.enumerated()
            .sorted { (order.firstIndex(of: $0.element.pick.courseKind)!, $0.offset)
                    < (order.firstIndex(of: $1.element.pick.courseKind)!, $1.offset) }
            .map { (kind: $0.element.pick.courseKind, text: $0.element.pick.menuLine, kcal: kcal($0.element.pick)) }
        return Applied(title: "", menuText: "", menuKcal: "", courses: courses, eatenBy: eatenBy, place: place)
    }
}
