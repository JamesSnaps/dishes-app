// The web app's design, in SwiftUI. Everything here mirrors a token or a
// component in apps/web so the two apps look like one product. The rules are
// in DESIGN.md ("Cookbook"):
//
//   colours      apps/web/app/globals.css, light and dark (DESIGN.md → Tokens)
//   Card         packages/ui card.tsx — `raised`: rounded-2xl, soft shadow, no border
//   BadgeView    packages/ui badge.tsx — neutral / brand / success / warning / outline
//   buttons      packages/ui button.tsx — pills: .primary, .secondary, .ink (AI)
//   type         Fraunces (bundled, SIL OFL) for headings and recipe titles via
//                Theme.serif; the system font (SF Pro) for everything else
//   gradients    legacy: the web's old bg-gradient-to-r buttons, still used by
//                screens not yet moved to Cookbook. Don't use them in new code.
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
    // MARK: Tokens (globals.css, DESIGN.md → Tokens)

    /// --background: cream page
    static let background = Color(light: 0xFBF7F0, dark: 0x1A1714)
    /// --foreground
    static let foreground = Color(light: 0x2A2420, dark: 0xF3EDE4)
    /// --card: floating surfaces only (sheets, popovers)
    static let card = Color(light: 0xFFFDF8, dark: 0x24201C)
    /// --muted / --accent: tinted panels and fields
    static let muted = Color(light: 0xF1EADF, dark: 0x2E2924)
    /// --muted-foreground
    static let mutedForeground = Color(light: 0x6E6259, dark: 0xB3A79A)
    /// --secondary: secondary buttons and chips
    static let secondary = Color(light: 0xEDE3D3, dark: 0x38312B)
    /// --secondary-foreground
    static let secondaryForeground = Color(light: 0x2A2420, dark: 0xF3EDE4)
    /// --border
    static let border = Color(light: 0xE8DFD1, dark: 0x3A332D)
    /// --input: input borders, dashed "add" outlines
    static let input = Color(light: 0xDCCFBC, dark: 0x4A4139)
    /// --primary: terracotta — the main action, the brand, today, selected
    static let brand = Color(light: 0xB5462B, dark: 0xE07A5F)
    /// --primary-foreground: text on brand
    static let brandForeground = Color(light: 0xFFFFFF, dark: 0x1A1714)
    /// Pressed states
    static let brandDeep = Color(light: 0x9A3B26, dark: 0xC9664C)
    /// --ink: AI and strong neutral actions
    static let ink = Color(light: 0x2A2420, dark: 0xF3EDE4)
    static let inkForeground = Color(light: 0xFBF7F0, dark: 0x1A1714)
    /// --success: herb green — healthy, done
    static let success = Color(light: 0x3D6B4F, dark: 0x8FBF9F)
    static let successTint = Color(light: 0xE3EDE4, dark: 0x22322A)
    /// --warning: ochre — needs attention
    static let warning = Color(light: 0x8A5A0B, dark: 0xE0B45C)
    static let warningTint = Color(light: 0xF6E7C1, dark: 0x3A2E16)
    static let destructive = Color(light: 0xB42318, dark: 0xF07A6A)
    /// --highlight: today's row or column, the open day
    static let highlight = Color(light: 0xF6EEE3, dark: 0x3A2C24)
    /// --plate: behind food images
    static let plate = Color(light: 0xE6D8C2, dark: 0x3A322A)
    /// Favourite heart: brand, like everything else that means "yours"
    static let heart = brand

    // MARK: Type

    /// Fraunces for headings, recipe titles and notes (DESIGN.md → Type).
    /// Falls back to the system serif (New York) if the bundled font is missing.
    static func serif(_ size: CGFloat, weight: Font.Weight = .semibold, italic: Bool = false) -> Font {
        let font: Font = hasFraunces ? .custom("Fraunces", size: size) : .system(size: size, design: .serif)
        let weighted = font.weight(weight)
        return italic ? weighted.italic() : weighted
    }

    private static let hasFraunces = UIFont.familyNames.contains("Fraunces")

    /// The small-caps overline: "BREAKFAST", "TONIGHT · 6:30PM".
    static let overline = Font.system(size: 11, weight: .bold)

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
            // Fixed terracotta: these buttons always carry white text.
            case .brand: [Color(hex: 0xB5462B), Color(hex: 0xB5462B)]
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

/// packages/ui Card `raised`: rounded-2xl bg-card, a soft warm shadow, no border.
struct CardBackground: ViewModifier {
    var radius: CGFloat = 16
    var fill: Color = Theme.card

    func body(content: Content) -> some View {
        content
            .background(fill, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .shadow(color: Color(hex: 0x2A2420).opacity(0.06), radius: 1, y: 1)
            .shadow(color: Color(hex: 0x2A2420).opacity(0.06), radius: 8, y: 6)
    }
}

extension View {
    func card(radius: CGFloat = 16, fill: Color = Theme.card) -> some View {
        modifier(CardBackground(radius: radius, fill: fill))
    }

    /// packages/ui Card `panel`: a tinted group, no border or shadow.
    func panel(radius: CGFloat = 16, fill: Color = Theme.muted) -> some View {
        background(fill, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
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
    /// `secondary` is the old name for `neutral`.
    enum Style { case secondary, neutral, brand, success, warning, outline }
    let text: String
    var style: Style = .secondary

    private var colors: (fill: Color, text: Color) {
        switch style {
        case .secondary, .neutral: (Theme.secondary, Theme.secondaryForeground)
        case .brand: (Theme.highlight, Theme.brand)
        case .success: (Theme.successTint, Theme.success)
        case .warning: (Theme.warningTint, Theme.warning)
        case .outline: (.clear, Theme.foreground)
        }
    }

    var body: some View {
        Text(text)
            .font(.system(size: 12, weight: .semibold))
            .lineLimit(1)
            .padding(.horizontal, 10)
            .padding(.vertical, 3)
            .foregroundStyle(colors.text)
            .background(colors.fill, in: Capsule())
            .overlay(Capsule().strokeBorder(style == .outline ? Theme.border : .clear))
    }
}

// MARK: Cookbook pieces

/// packages/ui SectionLabel: "BREAKFAST", "TONIGHT · 6:30PM".
struct SectionLabel: View {
    let text: String
    var brand = false

    var body: some View {
        Text(text.uppercased())
            .font(Theme.overline)
            .tracking(1.1)
            .foregroundStyle(brand ? Theme.brand : Theme.mutedForeground)
    }
}

/// packages/ui Plate: a food photo on the `plate` colour, or an empty plate
/// when there's no photo. Size and clip it where it's used.
struct PlateView<Photo: View>: View {
    var hasPhoto: Bool
    @ViewBuilder var photo: Photo

    var body: some View {
        ZStack {
            Theme.plate
            if hasPhoto {
                photo
            } else {
                GeometryReader { geo in
                    let d = min(geo.size.width, geo.size.height) * 0.62
                    Circle()
                        .fill(Theme.card)
                        .frame(width: d, height: d)
                        .shadow(color: Color(hex: 0x462D14).opacity(0.18), radius: 7, y: 6)
                        .overlay(Circle().fill(Theme.plate).frame(width: d * 0.64, height: d * 0.64))
                        .position(x: geo.size.width / 2, y: geo.size.height / 2)
                }
                .accessibilityHidden(true)
            }
        }
    }
}

extension PlateView where Photo == EmptyView {
    init() { self.init(hasPhoto: false) { EmptyView() } }
}

// MARK: Buttons

/// The web's big action buttons: a gradient, white text, rounded-lg, shadow-md.
struct GradientButtonStyle: ButtonStyle {
    var gradient: Theme.Gradient = .brand
    var height: CGFloat = 46

    func makeBody(configuration: Configuration) -> some View {
        Filled(configuration: configuration, gradient: gradient, height: height)
    }

    /// A disabled one fades, with no shadow, so it doesn't look ready to tap
    /// ("Draft 0 dinners" with the week already planned).
    private struct Filled: View {
        @Environment(\.isEnabled) private var enabled
        let configuration: Configuration
        let gradient: Theme.Gradient
        let height: CGFloat

        var body: some View {
            configuration.label
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: height)
                .padding(.horizontal, 14)
                .background(gradient.linear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .shadow(color: .black.opacity(enabled ? 0.12 : 0), radius: 5, y: 3)
                .opacity(!enabled ? 0.45 : configuration.isPressed ? 0.88 : 1)
        }
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

/// packages/ui Button: a pill. `.primary` (terracotta, one per area),
/// `.secondary` (everything else), `.ink` (AI — pair it with the sparkles icon).
struct PillButtonStyle: ButtonStyle {
    enum Kind { case primary, secondary, ink }
    var kind: Kind
    var height: CGFloat = 44

    func makeBody(configuration: Configuration) -> some View {
        Pill(configuration: configuration, kind: kind, height: height)
    }

    private struct Pill: View {
        @Environment(\.isEnabled) private var enabled
        let configuration: Configuration
        let kind: Kind
        let height: CGFloat

        var body: some View {
            let (fill, text): (Color, Color) = switch kind {
            case .primary: (Theme.brand, Theme.brandForeground)
            case .secondary: (Theme.secondary, Theme.secondaryForeground)
            case .ink: (Theme.ink, Theme.inkForeground)
            }
            configuration.label
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(text)
                .padding(.horizontal, 20)
                .frame(minHeight: height)
                .background(fill, in: Capsule())
                .opacity(!enabled ? 0.45 : configuration.isPressed ? 0.85 : 1)
        }
    }
}

extension ButtonStyle where Self == PillButtonStyle {
    static var primary: PillButtonStyle { PillButtonStyle(kind: .primary) }
    static var secondary: PillButtonStyle { PillButtonStyle(kind: .secondary) }
    static var ink: PillButtonStyle { PillButtonStyle(kind: .ink) }
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

extension Recipe {
    /// Its card photo, for ImageCache.prefetch.
    @MainActor var thumbnailURL: URL? { AppModel.shared.imageURL(thumbnailUrl ?? imageUrl) }
    @MainActor var photoURL: URL? { AppModel.shared.imageURL(imageUrl) }
}

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
                    CachedImage(url: url) { placeholder }
                } else {
                    placeholder
                }
            }
            .clipped()
    }
}
