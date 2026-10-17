// The Dishes look on iOS: the web's warm orange (--primary, hsl 24 95% 53%) on
// warm tinted surfaces, with gradients and shadows rather than flat white
// boxes (CLAUDE.md, "No wireframe/white-box UI"). Standard iOS controls
// throughout; this only colours them.

import DishesCore
import SwiftUI

enum Theme {
    static let brand = Color.accentColor
    static let brandDeep = Color(red: 0.92, green: 0.35, blue: 0.05)
    static let warm = Color(red: 1.0, green: 0.97, blue: 0.93)

    /// The page background: a faint warm wash, deeper in dark mode.
    static let background = LinearGradient(
        colors: [Color.orange.opacity(0.10), Color(.systemBackground)],
        startPoint: .top, endPoint: .center)

    static let brandGradient = LinearGradient(colors: [brand, brandDeep], startPoint: .topLeading, endPoint: .bottomTrailing)

    /// A stable colour per cuisine (or any string), for placeholders where there's no photo.
    static func tint(for text: String?) -> Color {
        let palette: [Color] = [.orange, .red, .pink, .purple, .indigo, .teal, .green, .brown]
        let sum = (text ?? "").unicodeScalars.reduce(0) { $0 + Int($1.value) }
        return palette[sum % palette.count]
    }
}

/// A raised, tinted card.
struct CardBackground: ViewModifier {
    var tint: Color = Theme.brand

    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(LinearGradient(colors: [tint.opacity(0.16), tint.opacity(0.05)],
                                         startPoint: .topLeading, endPoint: .bottomTrailing))
                    .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color(.secondarySystemGroupedBackground)))
                    .shadow(color: tint.opacity(0.18), radius: 10, y: 4))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(tint.opacity(0.18)))
    }
}

extension View {
    func card(tint: Color = Theme.brand) -> some View { modifier(CardBackground(tint: tint)) }
}

/// The main action on a screen: solid brand gradient, obviously a button.
struct BrandButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(.white)
            .padding(.vertical, 14)
            .padding(.horizontal, 22)
            .background(Capsule().fill(Theme.brandGradient))
            .shadow(color: Theme.brand.opacity(0.35), radius: 8, y: 4)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}

extension ButtonStyle where Self == BrandButtonStyle {
    static var brand: BrandButtonStyle { BrandButtonStyle() }
}

/// A recipe photo, or a tinted placeholder with the dish's initial when there isn't one.
struct RecipeImage: View {
    @Environment(AppModel.self) private var app
    let recipe: Recipe
    var thumbnail = true

    var body: some View {
        let placeholder = ZStack {
            LinearGradient(colors: [Theme.tint(for: recipe.cuisine ?? recipe.title).opacity(0.85),
                                    Theme.tint(for: recipe.cuisine ?? recipe.title).opacity(0.45)],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
            Text(recipe.title.prefix(1))
                .font(.system(.largeTitle, design: .rounded, weight: .bold))
                .foregroundStyle(.white.opacity(0.9))
        }
        if let url = app.imageURL(thumbnail ? (recipe.thumbnailUrl ?? recipe.imageUrl) : recipe.imageUrl) {
            AsyncImage(url: url) { phase in
                if let image = phase.image { image.resizable().scaledToFill() } else { placeholder }
            }
        } else {
            placeholder
        }
    }
}

enum Format {
    /// "600.000" → "600", "0.50" → "½". The full rules (unit promotion,
    /// metric/imperial) are lib/format-quantity.ts, to be ported with shared
    /// fixtures (TODO_MOBILE.md, C2).
    static func amount(_ raw: String?, scale: Double = 1) -> String? {
        guard let raw, let value = Double(raw) else { return raw }
        let scaled = value * scale
        let whole = scaled.rounded(.down)
        let fractions: [(Double, String)] = [(0.25, "¼"), (1.0 / 3, "⅓"), (0.5, "½"), (2.0 / 3, "⅔"), (0.75, "¾")]
        let rest = scaled - whole
        if rest < 0.02 { return String(Int(whole)) }
        if let f = fractions.first(where: { abs($0.0 - rest) < 0.03 }), scaled < 20 {
            return whole == 0 ? f.1 : "\(Int(whole))\(f.1)"
        }
        return scaled.formatted(.number.precision(.fractionLength(0...1)))
    }

    static func quantity(_ amount: String?, _ unit: String?, scale: Double = 1) -> String {
        [Self.amount(amount, scale: scale), unit].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
    }

    static func minutes(_ total: Int?) -> String? {
        guard let total, total > 0 else { return nil }
        if total < 60 { return "\(total) min" }
        let h = total / 60, m = total % 60
        return m == 0 ? "\(h) hr" : "\(h) hr \(m) min"
    }
}
