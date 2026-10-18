// What makes the cookbook look used: aged paper, the household's handwriting
// and the stains of cooking. Everything is drawn from a seed (the recipe's id),
// so a page looks the same every time it's turned to, like a real book — and
// everything is earned: stains build up with how often a dish has been cooked,
// and handwriting is only ever a real note, a real count or a real date.
//
// Handwriting deliberately varies: each member writes in their own hand and
// ink (Pen.member), and notes nobody signed get a pen of their own (Pen.any),
// so a page never looks like one font in one colour.

import DishesCore
import SwiftUI
import UIKit

/// SplitMix64 seeded from a string (FNV-1a), for stable "randomness".
struct Seeded: RandomNumberGenerator {
    private var state: UInt64

    init(_ seed: String) {
        state = seed.utf8.reduce(14_695_981_039_346_656_037) { ($0 ^ UInt64($1)) &* 1_099_511_628_211 }
    }

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

// MARK: Paper and type

enum Paper {
    static let page = Color(hex: 0xF3EAD6)
    static let ink = Color(hex: 0x2E241B)
    static let soft = Color(hex: 0x5A4A3A)
    static let faint = Color(hex: 0x8A7458)
    static let accent = Color(hex: 0xA0522D)
    static let rule = Color(hex: 0xCDBB98)
    static let desk = Color(hex: 0x2A1F17)

    static func serif(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .serif)
    }

    /// The UIKit twin of `serif`, for measuring text before it's laid out.
    static func uiSerif(_ size: CGFloat, italic: Bool = false, weight: UIFont.Weight = .regular) -> UIFont {
        var descriptor = UIFont.systemFont(ofSize: size, weight: weight).fontDescriptor
        descriptor = descriptor.withDesign(.serif) ?? descriptor
        if italic { descriptor = descriptor.withSymbolicTraits(.traitItalic) ?? descriptor }
        return UIFont(descriptor: descriptor, size: size)
    }
}

/// Page colour, a faint grain, warmer edges and the shadow of the spine.
struct PaperTexture: View {
    let seed: String
    /// Which side the spine is on (.leading for a right-hand page), or nil for a page on its own.
    var spine: HorizontalEdge?
    var base = Paper.page

    var body: some View {
        ZStack {
            base
            Canvas { context, size in
                var rng = Seeded(seed + ".grain")
                let count = Int(size.width * size.height / 240)
                for _ in 0..<count {
                    let x = CGFloat.random(in: 0...size.width, using: &rng)
                    let y = CGFloat.random(in: 0...size.height, using: &rng)
                    let r = CGFloat.random(in: 0.4...1.1, using: &rng)
                    let dark = Bool.random(using: &rng)
                    context.fill(Path(ellipseIn: CGRect(x: x, y: y, width: r, height: r)),
                                 with: .color(dark ? Color(hex: 0x6B4F2E).opacity(0.07) : .white.opacity(0.3)))
                }
            }
            RadialGradient(colors: [.clear, Color(hex: 0xB8945A).opacity(0.2)],
                           center: .center, startRadius: 160, endRadius: 560)
            if let spine {
                LinearGradient(colors: [.black.opacity(0.18), .black.opacity(0.05), .clear],
                               startPoint: spine == .leading ? .leading : .trailing,
                               endPoint: spine == .leading ? .trailing : .leading)
                    .frame(width: 38)
                    .frame(maxWidth: .infinity, alignment: spine == .leading ? .leading : .trailing)
            }
        }
    }
}

// MARK: Pens

struct Pen: Hashable, Sendable {
    let fontName: String
    let size: CGFloat
    let colour: UInt32
    let opacity: Double

    /// iOS's own hands, so there's nothing to bundle: a felt tip, a biro scrawl,
    /// neat copperplate, a marker and a rounded print.
    private static let hands: [(String, CGFloat)] = [
        ("BradleyHandITCTT-Bold", 15),
        ("Noteworthy-Light", 15),
        ("SnellRoundhand", 17),
        ("MarkerFelt-Thin", 15),
        ("ChalkboardSE-Light", 13.5),
    ]
    /// Blue biro, black ink, red pen, pencil, green ink, purple ink.
    private static let inks: [(UInt32, Double)] = [
        (0x1F3A93, 0.9), (0x2B2B2B, 0.85), (0xB03A2E, 0.85), (0x5E5E5E, 0.7), (0x2E6B3A, 0.85), (0x5B3A8C, 0.85),
    ]

    var color: Color { Color(hex: colour).opacity(opacity) }
    func font(_ scale: CGFloat = 1) -> Font { .custom(fontName, size: size * scale) }

    /// A member's own pen: the same hand and ink on every page.
    static func member(_ index: Int) -> Pen {
        let hand = hands[index % hands.count]
        let ink = inks[(index * 2) % inks.count]
        return Pen(fontName: hand.0, size: hand.1, colour: ink.0, opacity: ink.1)
    }

    /// A pen for one unsigned note, picked from its seed.
    static func any(_ seed: String) -> Pen {
        var rng = Seeded(seed + ".pen")
        let hand = hands.randomElement(using: &rng)!
        let ink = inks.randomElement(using: &rng)!
        return Pen(fontName: hand.0, size: hand.1, colour: ink.0, opacity: ink.1)
    }

    static let pencil = Pen(fontName: "Noteworthy-Light", size: 14, colour: 0x5E5E5E, opacity: 0.7)
}

/// A line of handwriting, never quite level.
struct Handwriting: View {
    let text: String
    let pen: Pen
    let seed: String
    var scale: CGFloat = 1

    private var tilt: Double {
        var rng = Seeded(seed + ".tilt")
        return Double.random(in: -3.5...2.5, using: &rng)
    }

    var body: some View {
        Text(text)
            .font(pen.font(scale))
            .foregroundStyle(pen.color)
            .lineSpacing(-2)
            .fixedSize(horizontal: false, vertical: true)
            .rotationEffect(.degrees(tilt))
    }
}

/// Tally marks for each time it's been cooked, in pencil.
struct Tally: View {
    let count: Int
    let seed: String

    var body: some View {
        let groups = (count + 4) / 5
        Canvas { context, size in
            var rng = Seeded(seed + ".tally")
            var x: CGFloat = 2
            var left = count
            for _ in 0..<groups {
                let n = min(5, left)
                left -= n
                let start = x
                for i in 0..<min(n, 4) {
                    var p = Path()
                    let jitter = { CGFloat.random(in: -1.2...1.2, using: &rng) }
                    p.move(to: CGPoint(x: x + jitter(), y: 3 + jitter()))
                    p.addLine(to: CGPoint(x: x + jitter(), y: size.height - 3 + jitter()))
                    context.stroke(p, with: .color(Pen.pencil.color), lineWidth: 1.4)
                    x += 5
                    _ = i
                }
                if n == 5 {
                    var p = Path()
                    p.move(to: CGPoint(x: start - 3, y: size.height - 5))
                    p.addLine(to: CGPoint(x: x - 1, y: 5))
                    context.stroke(p, with: .color(Pen.pencil.color), lineWidth: 1.4)
                }
                x += 7
            }
        }
        .frame(width: CGFloat(groups) * 27, height: 22)
        .accessibilityLabel("Cooked \(count) times")
    }
}

/// A quick heart, the way you'd scribble one next to a favourite.
struct ScribbledHeart: View {
    var color = Color(hex: 0xB03A2E).opacity(0.85)

    var body: some View {
        Canvas { context, size in
            let w = size.width, h = size.height
            var p = Path()
            p.move(to: CGPoint(x: w * 0.5, y: h * 0.92))
            p.addCurve(to: CGPoint(x: w * 0.06, y: h * 0.32), control1: CGPoint(x: w * 0.2, y: h * 0.7), control2: CGPoint(x: w * -0.02, y: h * 0.5))
            p.addCurve(to: CGPoint(x: w * 0.5, y: h * 0.26), control1: CGPoint(x: w * 0.16, y: h * 0.0), control2: CGPoint(x: w * 0.44, y: h * 0.02))
            p.addCurve(to: CGPoint(x: w * 0.95, y: h * 0.34), control1: CGPoint(x: w * 0.58, y: h * 0.0), control2: CGPoint(x: w * 0.96, y: h * 0.02))
            p.addCurve(to: CGPoint(x: w * 0.47, y: h * 0.96), control1: CGPoint(x: w * 0.98, y: h * 0.56), control2: CGPoint(x: w * 0.8, y: h * 0.72))
            context.stroke(p, with: .color(color), style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))
        }
        .frame(width: 22, height: 20)
        .rotationEffect(.degrees(-8))
        .accessibilityLabel("Favourite")
    }
}

// MARK: Stains

enum StainKind: CaseIterable {
    case gravy, flour, tomato, coffee, oil
}

struct Stain: Identifiable {
    let id: Int
    let kind: StainKind
    /// Where on the page, as a fraction of its size.
    let at: UnitPoint
    let size: CGFloat
    let seed: String
}

enum Stains {
    /// What a recipe would splash, from its title, tags and cuisine.
    static func kinds(for recipe: Recipe) -> [StainKind] {
        let words = ([recipe.title, recipe.cuisine ?? ""] + recipe.tags).joined(separator: " ").lowercased()
        func has(_ any: String...) -> Bool { any.contains { words.contains($0) } }
        var kinds: [StainKind] = []
        if has("bake", "baking", "bread", "cake", "cookie", "biscuit", "pastry", "pie", "scone", "muffin", "flour", "dough", "loaf") { kinds.append(.flour) }
        if has("roast", "gravy", "stew", "beef", "lamb", "pork", "casserole", "sunday", "pie", "sausage") { kinds.append(.gravy) }
        if has("tomato", "pasta", "bolognese", "sauce", "curry", "chilli", "pizza", "ragù", "ragu", "shakshuka") { kinds.append(.tomato) }
        if has("salad", "fry", "fried", "dressing", "olive") { kinds.append(.oil) }
        return kinds + [.coffee]
    }

    /// The stains on one page: none on a dish never cooked, then more with use.
    static func on(page seed: String, recipe: Recipe, cooks: Int) -> [Stain] {
        let count = cooks == 0 ? 0 : cooks <= 2 ? 1 : cooks <= 6 ? 2 : 3
        guard count > 0 else { return [] }
        var rng = Seeded(seed + ".stains")
        // Corners and edges only: never across the text.
        var spots: [UnitPoint] = [UnitPoint(x: 0.9, y: 0.06), UnitPoint(x: 0.1, y: 0.95), UnitPoint(x: 0.94, y: 0.9),
                                  UnitPoint(x: 0.06, y: 0.1), UnitPoint(x: 0.55, y: 0.99)]
        spots.shuffle(using: &rng)
        let kinds = kinds(for: recipe)
        return (0..<count).map { i in
            let kind = i == 0 ? kinds[0] : kinds.randomElement(using: &rng)!
            let base: CGFloat = kind == .coffee ? 96 : kind == .flour ? 130 : 110
            return Stain(id: i, kind: kind, at: spots[i], size: base * CGFloat.random(in: 0.75...1.2, using: &rng),
                         seed: "\(seed).\(i)")
        }
    }
}

struct StainsLayer: View {
    let stains: [Stain]

    var body: some View {
        GeometryReader { geo in
            ForEach(stains) { stain in
                StainView(stain: stain)
                    .frame(width: stain.size, height: stain.size)
                    .position(x: geo.size.width * stain.at.x, y: geo.size.height * stain.at.y)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

struct StainView: View {
    let stain: Stain

    var body: some View {
        Canvas { context, size in
            var rng = Seeded(stain.seed)
            let c = CGPoint(x: size.width / 2, y: size.height / 2)
            let r = min(size.width, size.height) / 2
            switch stain.kind {
            case .gravy:
                context.fill(blob(c, r * 0.62, &rng), with: .color(Color(hex: 0x7A4A22).opacity(0.24)))
                context.fill(blob(c, r * 0.4, &rng), with: .color(Color(hex: 0x5C3416).opacity(0.1)))
                drops(&context, c, r, count: 5, color: Color(hex: 0x7A4A22).opacity(0.2), &rng)
            case .tomato:
                context.fill(blob(c, r * 0.42, &rng), with: .color(Color(hex: 0xB5432A).opacity(0.2)))
                drops(&context, c, r, count: 14, color: Color(hex: 0xB5432A).opacity(0.22), &rng)
            case .oil:
                let rect = CGRect(x: c.x - r * 0.5, y: c.y - r * 0.45, width: r, height: r * 0.9)
                context.fill(Path(ellipseIn: rect), with: .color(Color(hex: 0xC9A227).opacity(0.14)))
                context.stroke(Path(ellipseIn: rect), with: .color(Color(hex: 0x9C7A14).opacity(0.14)), lineWidth: 2)
            case .coffee:
                // A mug ring: thick in places, broken in others.
                var angle = Double.random(in: 0...(2 * .pi), using: &rng)
                let end = angle + Double.random(in: 1.6...1.9, using: &rng) * .pi
                while angle < end {
                    let next = angle + 0.25
                    var arc = Path()
                    arc.addArc(center: c, radius: r * 0.8, startAngle: .radians(angle), endAngle: .radians(next), clockwise: false)
                    context.stroke(arc, with: .color(Color(hex: 0x6B4423).opacity(0.17)),
                                   lineWidth: CGFloat.random(in: 2...5.5, using: &rng))
                    angle = next
                }
            case .flour:
                context.fill(Path(ellipseIn: CGRect(x: c.x - r * 0.8, y: c.y - r * 0.35, width: r * 1.6, height: r * 0.7)),
                             with: .color(.white.opacity(0.28)))
                for _ in 0..<70 {
                    let a = Double.random(in: 0...(2 * .pi), using: &rng)
                    let d = r * CGFloat.random(in: 0...0.95, using: &rng)
                    let s = CGFloat.random(in: 0.8...2.4, using: &rng)
                    let p = CGPoint(x: c.x + cos(a) * d, y: c.y + sin(a) * d * 0.55)
                    context.fill(Path(ellipseIn: CGRect(x: p.x, y: p.y, width: s, height: s)), with: .color(.white.opacity(0.75)))
                }
            }
        }
        .blendMode(stain.kind == .flour ? .normal : .multiply)
    }

    private func blob(_ c: CGPoint, _ r: CGFloat, _ rng: inout Seeded) -> Path {
        let n = 11
        let points: [CGPoint] = (0..<n).map { i in
            let a = Double(i) / Double(n) * 2 * .pi
            let d = r * CGFloat.random(in: 0.72...1.18, using: &rng)
            return CGPoint(x: c.x + cos(a) * d, y: c.y + sin(a) * d * 0.85)
        }
        var path = Path()
        for i in 0..<n {
            let p = points[i], q = points[(i + 1) % n]
            let mid = CGPoint(x: (p.x + q.x) / 2, y: (p.y + q.y) / 2)
            if i == 0 { path.move(to: mid) } else { path.addQuadCurve(to: mid, control: p) }
        }
        let first = CGPoint(x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2)
        path.addQuadCurve(to: first, control: points[0])
        path.closeSubpath()
        return path
    }

    private func drops(_ context: inout GraphicsContext, _ c: CGPoint, _ r: CGFloat, count: Int, color: Color, _ rng: inout Seeded) {
        for _ in 0..<count {
            let a = Double.random(in: 0...(2 * .pi), using: &rng)
            let d = r * CGFloat.random(in: 0.6...1.0, using: &rng)
            let s = CGFloat.random(in: 2...7, using: &rng)
            context.fill(Path(ellipseIn: CGRect(x: c.x + cos(a) * d, y: c.y + sin(a) * d, width: s, height: s)), with: .color(color))
        }
    }
}
