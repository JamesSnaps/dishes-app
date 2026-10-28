import Foundation
import Testing
@testable import DishesCore

/// "Help me choose": the picks as the server sends them, what ticking some
/// puts on the log sheet (the web sheet's applyChoice), and the form the
/// request goes up as.
struct MenuPicksTests {
    static let json = """
    {
      "date": "2026-10-28",
      "restaurant": { "name": "Côte", "cuisine": "French" },
      "diners": [
        { "name": "James", "picks": [
            { "dish": "Sea bass", "course": "main", "menuLine": "Sea bass, crushed potatoes, beurre blanc",
              "menuKcal": 720, "estimatedKcal": null, "why": "Fish — you're short this week.", "lighterTweak": "Sauce on the side" },
            { "dish": "Onion soup", "course": "starter", "menuLine": "French onion soup, gruyère croute",
              "menuKcal": null, "estimatedKcal": 380, "why": "Light to start.", "lighterTweak": null }
          ], "avoid": [ { "dish": "Steak frites", "why": "Red meat's at its limit." } ] },
        { "name": "Sam", "picks": [
            { "dish": "Moules", "course": "main", "menuLine": "Moules marinière, frites",
              "menuKcal": null, "estimatedKcal": 900, "why": "You love mussels.", "lighterTweak": null }
          ], "avoid": [] }
      ],
      "note": null
    }
    """

    static func picks() throws -> MenuPicks {
        try JSONDecoder().decode(MenuPicks.self, from: Data(json.utf8))
    }

    @Test func decodesWhatTheServerSends() throws {
        let p = try Self.picks()
        #expect(p.restaurant.name == "Côte")
        #expect(p.diners.map(\.name) == ["James", "Sam"])
        #expect(p.diners[0].picks[0].kcalText == "720 kcal on the menu")
        #expect(p.diners[0].picks[1].kcalText == "about 380 kcal (estimate)")
        #expect(p.diners[0].picks[1].courseKind == .starter)
        #expect(p.diners[0].avoid.first?.dish == "Steak frites")
    }

    @Test func oneDishFillsInTheDishAndItsMenuLine() throws {
        let p = try Self.picks()
        let a = p.apply([.init(diner: "James", pick: p.diners[0].picks[0])],
                        everyone: ["James", "Sam"], isPlan: false, placeIsEmpty: true)
        #expect(a.title == "Sea bass")
        #expect(a.menuText == "Sea bass, crushed potatoes, beurre blanc")
        #expect(a.menuKcal == "720")
        #expect(a.courses.isEmpty)
        #expect(a.eatenBy == ["James"], "only the person it was for")
        #expect(a.place == "Côte")
    }

    @Test func severalBecomeCoursesInEatingOrder() throws {
        let p = try Self.picks()
        let a = p.apply([.init(diner: "James", pick: p.diners[0].picks[0]),
                         .init(diner: "James", pick: p.diners[0].picks[1]),
                         .init(diner: "Sam", pick: p.diners[1].picks[0])],
                        everyone: ["James", "Sam"], isPlan: false, placeIsEmpty: false)
        #expect(a.title.isEmpty && a.menuText.isEmpty)
        #expect(a.courses.map(\.kind) == [.starter, .main, .main], "starter first, mains in the order ticked")
        #expect(a.courses[0].kcal == "", "an estimate isn't a printed figure")
        #expect(a.courses[1].kcal == "720")
        #expect(a.eatenBy.isEmpty, "everyone ticked means everyone")
        #expect(a.place == nil, "a place already typed stays")
    }

    @Test func aPlanKeepsOnlyTheNames() throws {
        let p = try Self.picks()
        let a = p.apply([.init(diner: "James", pick: p.diners[0].picks[0]),
                         .init(diner: "James", pick: p.diners[0].picks[1])],
                        everyone: ["James", "Sam"], isPlan: true, placeIsEmpty: true)
        #expect(a.title == "Sea bass, Onion soup")
        #expect(a.courses.isEmpty && a.menuText.isEmpty)
    }

    @Test func theRequestGoesUpAsTheRouteReadsIt() throws {
        let body = APIClient.menuPicksBody(
            .init(date: "2026-10-28", members: ["James", "Sam"], photos: [Data([0xFF, 0xD8])], pdf: nil,
                  link: "  ", text: "Soup 6.50"),
            boundary: "B")
        let text = String(decoding: body, as: UTF8.self)
        #expect(text.contains("name=\"date\"\r\n\r\n2026-10-28\r\n"))
        #expect(text.components(separatedBy: "name=\"member\"").count == 3, "one field per member")
        #expect(text.contains("name=\"photo\"; filename=\"menu-1.jpg\"\r\nContent-Type: image/jpeg"))
        #expect(!text.contains("name=\"url\""), "a blank link isn't sent")
        #expect(!text.contains("name=\"pdf\""))
        #expect(text.contains("name=\"text\"\r\n\r\nSoup 6.50\r\n"))
        #expect(text.hasSuffix("--B--\r\n"))
    }
}
