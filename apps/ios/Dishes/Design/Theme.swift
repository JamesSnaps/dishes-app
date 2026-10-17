// The web app's design, in SwiftUI. Everything here mirrors a token or a
// component in apps/web so the two apps look like one product:
//
//   colours      apps/web/app/globals.css (shadcn slate + orange primary), light and dark
//   Card         packages/ui card.tsx — rounded-xl, 1px border, Tailwind `shadow`
//   BadgeView    packages/ui badge.tsx — secondary / outline pills
//   gradients    the bg-gradient-to-r pairs the web uses for its big action buttons
//   type         the web sets no font, so it renders in the system font: SF Pro
//                on Apple devices, which is what SwiftUI uses — sizes follow
//                Tailwind (text-xs 12, text-sm 14, text-base 16, text-2xl 24)
//
// Change a colour here only when it changes on the web.

import DishesCore
import SwiftUI
import UIKit

extension Color {
    /// A colour with a light and a dark value, as the web's `.dark` class swaps tokens.
    init(light: UInt32, dark: UInt32) {
        self.init(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
    }

    init(hex: UInt32) { self.init(UIColor(hex: hex)) }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                  blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}

enum Theme {
    // MARK: Tokens (globals.css)

    /// --background: white / slate-950
    static let background = Color(light: 0xFFFFFF, dark: 0x020817)
    /// --foreground
    static let foreground = Color(light: 0x020817, dark: 0xF8FAFC)
    /// --card
    static let card = Color(light: 0xFFFFFF, dark: 0x020817)
    /// --muted / --secondary / --accent: slate-100 / slate-800
    static let muted = Color(light: 0xF1F5F9, dark: 0x1E293B)
    /// --muted-foreground: slate-500 / slate-400
    static let mutedForeground = Color(light: 0x64748B, dark: 0x94A3B8)
    /// --secondary-foreground
    static let secondaryForeground = Color(light: 0x0F172A, dark: 0xF8FAFC)
    /// --border / --input: slate-200 / slate-800
    static let border = Color(light: 0xE2E8F0, dark: 0x1E293B)
    /// --primary: hsl(24 95% 53%) — orange-500
    static let brand = Color(hex: 0xF97316)
    static let brandDeep = Color(hex: 0xEA580C) // orange-600, for pressed states and text on tints
    static let destructive = Color(light: 0xEF4444, dark: 0xF87171)
    /// Favourite heart: fill-rose-500
    static let heart = Color(hex: 0xF43F5E)

    // MARK: Tailwind colours the web uses directly

    static let orange50 = Color(light: 0xFFF7ED, dark: 0x2A1608)
    static let rose50 = Color(light: 0xFFF1F2, dark: 0x2A0E14)
    static let violet50 = Color(light: 0xF5F3FF, dark: 0x1C1433)
    static let amber50 = Color(light: 0xFFFBEB, dark: 0x271C05)
    static let indigo50 = Color(light: 0xEEF2FF, dark: 0x161A3A)
    static let pink50 = Color(light: 0xFDF2F8, dark: 0x2A0F1F)
    static let emerald100 = Color(light: 0xD1FAE5, dark: 0x052E1F)
    static let emerald700 = Color(light: 0x047857, dark: 0x34D399)

    // MARK: Gradients (the web's bg-gradient-to-r pairs)

    enum Gradient {
        /// Banners and hero accents: from-orange-500 to-rose-500
        case orangeRose
        /// "Generate plan": from-violet-600 to-orange-500
        case violetOrange
        /// "Add N meals to list": from-blue-600 to-sky-500
        case blueSky
        /// "Add meal": from-violet-500 to-indigo-500
        case violetIndigo
        /// "Generate a side dish": from-emerald-600 to-teal-500
        case emeraldTeal
        /// Plain primary (bg-primary), in the same shape as the gradients
        case brand

        var colors: [Color] {
            switch self {
            case .orangeRose: [Color(hex: 0xF97316), Color(hex: 0xF43F5E)]
            case .violetOrange: [Color(hex: 0x7C3AED), Color(hex: 0xF97316)]
            case .blueSky: [Color(hex: 0x2563EB), Color(hex: 0x0EA5E9)]
            case .violetIndigo: [Color(hex: 0x8B5CF6), Color(hex: 0x6366F1)]
            case .emeraldTeal: [Color(hex: 0x059669), Color(hex: 0x14B8A6)]
            case .brand: [Color(hex: 0xF97316), Color(hex: 0xF97316)]
            }
        }

        var linear: LinearGradient { LinearGradient(colors: colors, startPoint: .leading, endPoint: .trailing) }
    }

    static let brandGradient = Gradient.orangeRose.linear

    /// Placeholder icon colour (text-muted-foreground/30).
    static let placeholderIcon = Color(light: 0x64748B, dark: 0x94A3B8).opacity(0.3)

    // MARK: Meal types (meal-plan/_components/entry-card.tsx)

    static func mealColor(_ type: String) -> Color {
        switch type {
        case "breakfast": Color(hex: 0xF59E0B) // amber-500
        case "lunch": Color(hex: 0x8B5CF6) // violet-500
        case "dinner": Color(hex: 0x6366F1) // indigo-500
        case "dessert": Color(hex: 0xEC4899) // pink-500
        default: mutedForeground
        }
    }

    static func mealBackground(_ type: String) -> Color {
        switch type {
        case "breakfast": amber50
        case "lunch": violet50
        case "dinner": indigo50
        case "dessert": pink50
        default: muted.opacity(0.5)
        }
    }

    static func mealIcon(_ type: String) -> String {
        switch type {
        case "breakfast": "sunrise"
        case "lunch": "sun.max"
        case "dinner": "moon"
        case "dessert": "birthday.cake"
        default: "carrot"
        }
    }
}

// MARK: Card

/// packages/ui Card: rounded-xl border bg-card shadow.
struct CardBackground: ViewModifier {
    var radius: CGFloat = 12
    var fill: Color = Theme.card

    func body(content: Content) -> some View {
        content
            .background(fill, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Theme.border))
            // Tailwind `shadow`: 0 1px 3px rgb(0 0 0 / .1), 0 1px 2px -1px rgb(0 0 0 / .1)
            .shadow(color: .black.opacity(0.08), radius: 2, y: 1)
    }
}

extension View {
    func card(radius: CGFloat = 12, fill: Color = Theme.card) -> some View {
        modifier(CardBackground(radius: radius, fill: fill))
    }

    /// The tinted callout boxes (nutrition, "What kind of dish is this?"): a soft
    /// gradient wash with a matching border.
    func callout(_ from: Color, _ to: Color, border: Color) -> some View {
        background(LinearGradient(colors: [from, to], startPoint: .topLeading, endPoint: .bottomTrailing),
                   in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(border))
    }
}

// MARK: Badge

/// packages/ui Badge: rounded-full px-2.5 py-0.5 text-xs font-semibold.
struct BadgeView: View {
    enum Style { case secondary, outline }
    let text: String
    var style: Style = .secondary

    var body: some View {
        Text(text)
            .font(.system(size: 12, weight: .semibold))
            .lineLimit(1)
            .padding(.horizontal, 10)
            .padding(.vertical, 3)
            .foregroundStyle(Theme.secondaryForeground)
            .background(style == .secondary ? Theme.muted : .clear, in: Capsule())
            .overlay(Capsule().strokeBorder(style == .outline ? Theme.border : .clear))
    }
}

// MARK: Buttons

/// The web's big action buttons: a gradient, white text, rounded-lg, shadow-md.
struct GradientButtonStyle: ButtonStyle {
    var gradient: Theme.Gradient = .brand
    var height: CGFloat = 46

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: height)
            .padding(.horizontal, 14)
            .background(gradient.linear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .shadow(color: .black.opacity(0.12), radius: 5, y: 3)
            .opacity(configuration.isPressed ? 0.88 : 1)
    }
}

/// Button variant="outline": border, background, foreground text.
struct OutlineButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(Theme.foreground)
            .padding(.horizontal, 14)
            .frame(minHeight: 38)
            .background(configuration.isPressed ? Theme.muted : Theme.background,
                        in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Theme.border))
    }
}

extension ButtonStyle where Self == GradientButtonStyle {
    static var brand: GradientButtonStyle { GradientButtonStyle() }
    static func gradient(_ g: Theme.Gradient) -> GradientButtonStyle { GradientButtonStyle(gradient: g) }
}

extension ButtonStyle where Self == OutlineButtonStyle {
    static var outline: OutlineButtonStyle { OutlineButtonStyle() }
}

/// The round orange "+" in page headers (h-9 w-9 rounded-full bg-orange-500 shadow-md).
struct RoundAddButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "plus")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 38, height: 38)
                .background(Theme.brand, in: Circle())
                .shadow(color: .black.opacity(0.15), radius: 4, y: 2)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Add")
    }
}

// MARK: Page furniture

/// Page header as the web draws it: a bold title with a muted line under it.
struct PageHeader<Trailing: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 26, weight: .bold))
                    .foregroundStyle(Theme.foreground)
                if let subtitle {
                    Text(subtitle).font(.system(size: 14)).foregroundStyle(Theme.mutedForeground)
                }
            }
            Spacer(minLength: 0)
            trailing
        }
    }
}

extension PageHeader where Trailing == EmptyView {
    init(title: String, subtitle: String? = nil) {
        self.init(title: title, subtitle: subtitle) { EmptyView() }
    }
}

/// "♥ Favourites ............ See all"
struct SectionHeader: View {
    let title: String
    var icon: String?
    var iconColor: Color = Theme.heart
    var action: (() -> Void)?

    var body: some View {
        HStack(spacing: 8) {
            if let icon { Image(systemName: icon).foregroundStyle(iconColor) }
            Text(title).font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.foreground)
            Spacer()
            if let action {
                Button("See all", action: action)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.brand)
            }
        }
    }
}

/// The search input: muted fill, magnifying glass, rounded-lg.
struct SearchField: View {
    let prompt: String
    @Binding var text: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").foregroundStyle(Theme.mutedForeground)
            TextField(prompt, text: $text)
                .font(.system(size: 15))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.mutedForeground)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 14)
        .frame(height: 44)
        .background(Theme.muted, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

/// rounded-xl border border-dashed bg-muted/20, with an emoji and a line.
struct EmptyBox: View {
    var emoji = "🍽"
    let message: String

    var body: some View {
        VStack(spacing: 8) {
            Text(emoji).font(.system(size: 30))
            Text(message).font(.system(size: 14)).foregroundStyle(Theme.mutedForeground)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 36)
        .background(Theme.muted.opacity(0.2), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
            .strokeBorder(Theme.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
    }
}

/// The favourite heart on a photo: bg-background/80 blurred circle, shadow-sm.
struct HeartButton: View {
    let isFavourite: Bool
    var size: CGFloat = 32
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: isFavourite ? "heart.fill" : "heart")
                .font(.system(size: size * 0.45, weight: .semibold))
                .foregroundStyle(isFavourite ? Theme.heart : Theme.mutedForeground)
                .frame(width: size, height: size)
                .background(Theme.background.opacity(0.85), in: Circle())
                .shadow(color: .black.opacity(0.1), radius: 1.5, y: 1)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isFavourite ? "Remove from favourites" : "Add to favourites")
    }
}

// MARK: Recipe image

/// A recipe photo, or the web's placeholder: bg-muted with a faint utensils icon.
struct RecipeImage: View {
    @Environment(AppModel.self) private var app
    let recipe: Recipe
    var thumbnail = true

    var body: some View {
        let placeholder = ZStack {
            Theme.muted
            Image(systemName: "fork.knife")
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(Theme.placeholderIcon)
        }
        // Color.clear takes exactly the size it's offered; the photo fills it and is
        // cropped. Without this a wide photo reports its natural width, and a card
        // grows into its neighbours (the burger on James's iPad, 17 Oct 2026).
        Color.clear
            .overlay {
                if let url = app.imageURL(thumbnail ? (recipe.thumbnailUrl ?? recipe.imageUrl) : recipe.imageUrl) {
                    AsyncImage(url: url) { phase in
                        if let image = phase.image { image.resizable().scaledToFill() } else { placeholder }
                    }
                } else {
                    placeholder
                }
            }
            .clipped()
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

    /// "25 min", "1 hr 15 min" — for prose.
    static func minutes(_ total: Int?) -> String? {
        guard let total, total > 0 else { return nil }
        if total < 60 { return "\(total) min" }
        let h = total / 60, m = total % 60
        return m == 0 ? "\(h) hr" : "\(h) hr \(m) min"
    }

    /// "25m", "1h 15m" — the web's compact form on cards (recipe-card.tsx totalTime).
    static func shortMinutes(_ total: Int?) -> String? {
        guard let total, total > 0 else { return nil }
        if total < 60 { return "\(total)m" }
        let h = total / 60, m = total % 60
        return m == 0 ? "\(h)h" : "\(h)h \(m)m"
    }
}
