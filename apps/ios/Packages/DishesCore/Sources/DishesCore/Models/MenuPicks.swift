import Foundation

/// "Help me choose": the household's AI reads a menu and suggests dishes for
/// each person and course (POST /api/v1/outside-meals/menu-picks;
/// lib/menu-choice.ts on the web). The answer streams as `MenuPicks.Event`s —
/// what the brief says it's weighing, each dish as the menu is read, the menu,
/// each pick — and nothing is saved: the dishes chosen fill in the log sheet.
public enum MenuPicks {
    public struct Restaurant: Codable, Hashable, Sendable {
        public var name: String?
        public var cuisine: String?
        public init(name: String?, cuisine: String?) { self.name = name; self.cuisine = cuisine }
    }

    /// One dish on the menu as read. `id` counts from 1 in menu order.
    public struct Item: Codable, Hashable, Sendable, Identifiable {
        public var id: Int
        /// The heading it's under, as written, or nil.
        public var section: String?
        public var name: String
        /// Name and description, word for word, without the price.
        public var line: String
        /// Printed on the menu, or nil.
        public var kcal: Int?
    }

    /// The menu as read: shown under "See the whole menu", and sent back for a swap.
    public struct Menu: Codable, Hashable, Sendable {
        public var restaurant: Restaurant
        public var items: [Item]
    }

    public struct Pick: Codable, Hashable, Sendable {
        /// The menu item's number.
        public var item: Int
        public var diner: String
        /// "starter", "main", "side", "dessert" or "drink".
        public var course: String
        public var dish: String
        /// The dish's line from the menu, word for word.
        public var menuLine: String
        /// Printed on the menu; nil when it isn't.
        public var menuKcal: Int?
        /// The AI's rough figure when nothing's printed.
        public var estimatedKcal: Int?
        /// Why it suits this person. Empty for a dish chosen from the menu by hand.
        public var why: String
        public var lighterTweak: String?

        public init(item: Int, diner: String, course: String, dish: String, menuLine: String, menuKcal: Int?,
                    estimatedKcal: Int?, why: String, lighterTweak: String?) {
            self.item = item; self.diner = diner; self.course = course; self.dish = dish; self.menuLine = menuLine
            self.menuKcal = menuKcal; self.estimatedKcal = estimatedKcal; self.why = why; self.lighterTweak = lighterTweak
        }

        /// A dish chosen from the whole menu by hand, as its section's course.
        public init(chosen item: Item, for diner: String) {
            self.init(item: item.id, diner: diner, course: MenuPicks.course(ofSection: item.section).rawValue, dish: item.name,
                      menuLine: item.line, menuKcal: item.kcal, estimatedKcal: nil, why: "", lighterTweak: nil)
        }

        public var courseKind: OutsideMeal.Course.Kind { OutsideMeal.Course.Kind(rawValue: course) ?? .main }

        /// "720 kcal on the menu", "about 650 kcal (estimate)", or nil.
        public var kcalText: String? {
            if let menuKcal { return "\(menuKcal) kcal on the menu" }
            if let estimatedKcal { return "about \(estimatedKcal) kcal (estimate)" }
            return nil
        }
    }

    public struct Avoid: Codable, Hashable, Sendable {
        public var diner: String
        public var item: Int
        public var dish: String
        public var why: String
    }

    /// One line of the streamed answer.
    public enum Event: Decodable, Sendable, Equatable {
        case stage(String)
        case fact(String)
        case dish(String)
        case menu(Menu)
        case pick(Pick)
        case avoid(Avoid)
        case done(note: String?)
        case error(String)
        /// A kind a newer server sends that this build doesn't know: ignored.
        case unknown

        enum Keys: String, CodingKey { case type, text, name, menu, pick, avoid, note, message }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            switch try c.decode(String.self, forKey: .type) {
            case "stage": self = .stage(try c.decode(String.self, forKey: .text))
            case "fact": self = .fact(try c.decode(String.self, forKey: .text))
            case "dish": self = .dish(try c.decode(String.self, forKey: .name))
            case "menu": self = .menu(try c.decode(Menu.self, forKey: .menu))
            case "pick": self = .pick(try c.decode(Pick.self, forKey: .pick))
            case "avoid": self = .avoid(try c.decode(Avoid.self, forKey: .avoid))
            case "done": self = .done(note: try c.decodeIfPresent(String.self, forKey: .note))
            case "error": self = .error(try c.decode(String.self, forKey: .message))
            default: self = .unknown
            }
        }
    }

    /// The mood chips (MENU_MOODS on the web).
    public enum Mood: String, CaseIterable, Sendable {
        case light, hearty, healthy, new, treat
        public var label: String {
            switch self {
            case .light: "Light"
            case .hearty: "Hearty"
            case .healthy: "Healthy"
            case .new: "Something new"
            case .treat: "Treat"
            }
        }
    }

    /// The reason chips on "Something else", sent as the swap's hint (SWAP_REASONS).
    public static let swapReasons = ["Lighter", "More filling", "No fish", "No meat", "Something different"]

    /// The course a menu section suggests ("Puddings" → dessert), for dishes chosen by hand (courseOfSection).
    public static func course(ofSection section: String?) -> OutsideMeal.Course.Kind {
        let s = (section ?? "").lowercased()
        func has(_ pattern: String) -> Bool { s.range(of: pattern, options: .regularExpression) != nil }
        if has("starter|appeti[sz]er|small plate|to start|antipast|nibble|tapas|mezze|soup") { return .starter }
        if has("dessert|pudding|sweet|afters") { return .dessert }
        if has("side|extra|accompaniment") { return .side }
        if has("drink|wine|beer|cocktail|beverage|soft|coffee|tea\\b") { return .drink }
        return .main
    }

    /// A pick that was chosen, with whose it was.
    public struct Chosen: Hashable, Sendable {
        public var diner: String
        public var pick: Pick
        public init(diner: String, pick: Pick) { self.diner = diner; self.pick = pick }
        public init(_ pick: Pick) { self.init(diner: pick.diner, pick: pick) }
    }

    /// What the chosen dishes put on the log sheet — the web sheet's
    /// `applyChoice`. One dish fills in the dish and its menu line; several
    /// become courses in eating order. A plan keeps only the names (its menu
    /// fields aren't on the form). Whoever they were for are the ones eating:
    /// everyone is `eatenBy` empty, which means everyone.
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

    public static func apply(_ chosen: [Chosen], restaurant: Restaurant?, everyone: [String], isPlan: Bool,
                             placeIsEmpty: Bool) -> Applied {
        let who = chosen.map(\.diner).reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
        let eatenBy = Set(who).isSuperset(of: everyone) ? [] : who
        let place = placeIsEmpty ? restaurant?.name.map { String($0.prefix(200)) } : nil
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
