import Foundation
import Testing
@testable import DishesCore

/// "Help me choose": the streamed events as the server sends them, what the
/// chosen dishes put on the log sheet (the web sheet's applyChoice), a
/// section's course, and the form the request goes up as.
struct MenuPicksTests {
    static func event(_ json: String) throws -> MenuPicks.Event {
        try JSONDecoder().decode(MenuPicks.Event.self, from: Data(json.utf8))
    }

    static let seaBass = MenuPicks.Pick(item: 4, diner: "James", course: "main", dish: "Sea bass",
                                        menuLine: "Sea bass, crushed potatoes, beurre blanc", menuKcal: 720,
                                        estimatedKcal: nil, why: "Fish — you're short this week.", lighterTweak: "Sauce on the side")
    static let soup = MenuPicks.Pick(item: 1, diner: "James", course: "starter", dish: "French onion soup",
                                     menuLine: "French onion soup, gruyère croûte", menuKcal: nil,
                                     estimatedKcal: 380, why: "Light to start.", lighterTweak: nil)
    static let moules = MenuPicks.Pick(item: 5, diner: "Sam", course: "main", dish: "Moules",
                                       menuLine: "Moules marinière, frites", menuKcal: nil,
                                       estimatedKcal: 900, why: "You love mussels.", lighterTweak: nil)

    @Test func decodesEveryEvent() throws {
        #expect(try Self.event(#"{"type":"stage","text":"Reading the menu"}"#) == .stage("Reading the menu"))
        #expect(try Self.event(#"{"type":"fact","text":"Red meat's at its limit this week"}"#) == .fact("Red meat's at its limit this week"))
        #expect(try Self.event(#"{"type":"dish","name":"Sea bass"}"#) == .dish("Sea bass"))
        let menu = try Self.event(#"{"type":"menu","menu":{"restaurant":{"name":"Côte","cuisine":"French"},"items":[{"id":1,"section":"Starters","name":"Soup","line":"Soup, croûte","kcal":null}]}}"#)
        guard case .menu(let m) = menu else { Issue.record("not a menu"); return }
        #expect(m.restaurant.name == "Côte")
        #expect(m.items.first?.line == "Soup, croûte")
        let pick = try Self.event(#"{"type":"pick","pick":{"item":4,"diner":"James","course":"main","dish":"Sea bass","menuLine":"Sea bass, crushed potatoes, beurre blanc","menuKcal":720,"estimatedKcal":null,"why":"Fish — you're short this week.","lighterTweak":"Sauce on the side"}}"#)
        #expect(pick == .pick(Self.seaBass))
        #expect(try Self.event(#"{"type":"avoid","avoid":{"diner":"James","item":5,"dish":"Steak frites","why":"Red meat."}}"#)
                == .avoid(.init(diner: "James", item: 5, dish: "Steak frites", why: "Red meat.")))
        #expect(try Self.event(#"{"type":"done","date":"2026-10-29","note":null}"#) == .done(note: nil))
        #expect(try Self.event(#"{"type":"error","message":"The menu couldn't be read."}"#) == .error("The menu couldn't be read."))
        #expect(try Self.event(#"{"type":"something-new","x":1}"#) == .unknown, "a newer server's event is ignored, not fatal")
    }

    @Test func kcalTextSaysWhichFigureItIs() {
        #expect(Self.seaBass.kcalText == "720 kcal on the menu")
        #expect(Self.soup.kcalText == "about 380 kcal (estimate)")
    }

    @Test func aDishChosenByHandTakesItsSectionsCourse() {
        let item = MenuPicks.Item(id: 9, section: "Puddings", name: "Sorbet", line: "Lemon sorbet", kcal: 220)
        let p = MenuPicks.Pick(chosen: item, for: "Sam")
        #expect(p.course == "dessert")
        #expect(p.diner == "Sam" && p.menuKcal == 220 && p.why.isEmpty)
        #expect(MenuPicks.course(ofSection: "Small plates") == .starter)
        #expect(MenuPicks.course(ofSection: "Sides & extras") == .side)
        #expect(MenuPicks.course(ofSection: "Cocktails") == .drink)
        #expect(MenuPicks.course(ofSection: "From the grill") == .main)
        #expect(MenuPicks.course(ofSection: nil) == .main)
    }

    @Test func oneDishFillsInTheDishAndItsMenuLine() {
        let a = MenuPicks.apply([.init(Self.seaBass)], restaurant: .init(name: "Côte", cuisine: nil),
                                everyone: ["James", "Sam"], isPlan: false, placeIsEmpty: true)
        #expect(a.title == "Sea bass")
        #expect(a.menuText == "Sea bass, crushed potatoes, beurre blanc")
        #expect(a.menuKcal == "720")
        #expect(a.courses.isEmpty)
        #expect(a.eatenBy == ["James"], "only the person it was for")
        #expect(a.place == "Côte")
    }

    @Test func severalBecomeCoursesInEatingOrder() {
        let a = MenuPicks.apply([.init(Self.seaBass), .init(Self.soup), .init(Self.moules)],
                                restaurant: .init(name: "Côte", cuisine: nil),
                                everyone: ["James", "Sam"], isPlan: false, placeIsEmpty: false)
        #expect(a.title.isEmpty && a.menuText.isEmpty)
        #expect(a.courses.map(\.kind) == [.starter, .main, .main], "starter first, mains in the order chosen")
        #expect(a.courses[0].kcal == "", "an estimate isn't a printed figure")
        #expect(a.courses[1].kcal == "720")
        #expect(a.eatenBy.isEmpty, "everyone means everyone")
        #expect(a.place == nil, "a place already typed stays")
    }

    @Test func aPlanKeepsOnlyTheNames() {
        let a = MenuPicks.apply([.init(Self.seaBass), .init(Self.soup)], restaurant: nil,
                                everyone: ["James", "Sam"], isPlan: true, placeIsEmpty: true)
        #expect(a.title == "Sea bass, French onion soup")
        #expect(a.courses.isEmpty && a.menuText.isEmpty)
    }

    @Test func theRequestGoesUpAsTheRouteReadsIt() {
        let first = String(decoding: APIClient.menuPicksBody(
            .init(date: "2026-10-29", members: ["James", "Sam"], photos: [Data([0xFF, 0xD8])], link: "  ",
                  text: "Soup 6.50", courses: ["starter", "main"], moods: ["light"], note: " "),
            boundary: "B"), as: UTF8.self)
        #expect(first.contains("name=\"date\"\r\n\r\n2026-10-29\r\n"))
        #expect(first.components(separatedBy: "name=\"member\"").count == 3, "one field per member")
        #expect(first.components(separatedBy: "name=\"course\"").count == 3)
        #expect(first.contains("name=\"mood\"\r\n\r\nlight\r\n"))
        #expect(!first.contains("name=\"note\""), "a blank note isn't sent")
        #expect(first.contains("name=\"photo\"; filename=\"menu-1.jpg\"\r\nContent-Type: image/jpeg"))
        #expect(!first.contains("name=\"url\""), "a blank link isn't sent")
        #expect(first.contains("name=\"text\"\r\n\r\nSoup 6.50\r\n"))
        #expect(!first.contains("name=\"menu\"") && !first.contains("swapDiner"))
        #expect(first.hasSuffix("--B--\r\n"))

        let menu = MenuPicks.Menu(restaurant: .init(name: "Côte", cuisine: nil),
                                  items: [.init(id: 4, section: "Mains", name: "Sea bass", line: "Sea bass", kcal: 720)])
        let swap = String(decoding: APIClient.menuPicksBody(
            .init(date: "2026-10-29", members: [], menu: menu, swapDiner: "James", swapCourse: "main",
                  exclude: [4, 7], hint: "No fish"),
            boundary: "B"), as: UTF8.self)
        #expect(swap.contains("name=\"menu\"\r\n\r\n{"), "the menu goes back as JSON")
        #expect(swap.contains("\"line\":\"Sea bass\""))
        #expect(swap.contains("name=\"swapDiner\"\r\n\r\nJames\r\n"))
        #expect(swap.contains("name=\"swapCourse\"\r\n\r\nmain\r\n"))
        #expect(swap.components(separatedBy: "name=\"exclude\"").count == 3)
        #expect(swap.contains("name=\"hint\"\r\n\r\nNo fish\r\n"))
        #expect(!swap.contains("name=\"photo\""), "a swap doesn't send the photos again")
    }
}
