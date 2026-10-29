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
    /// Stats charts only (DESIGN.md → Charts): terracotta, herb, ochre, slate blue, plum.
    static let chart1 = Color(light: 0xB5462B, dark: 0xE07A5F)
    static let chart2 = Color(light: 0x3D6B4F, dark: 0x8FBF9F)
    static let chart3 = Color(light: 0xB7791F, dark: 0xE0B45C)
    static let chart4 = Color(light: 0x4A6A8A, dark: 0x8FAFCF)
    static let chart5 = Color(light: 0x7A4A6E, dark: 0xC48FB4)

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

    // MARK: Meal types

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

/// packages/ui Button: a pill. `.primary` (terracotta, one per area),
/// `.secondary` (everything else), `.ink` (AI — pair it with the sparkles icon).
struct PillButtonStyle: ButtonStyle {
    enum Kind { case primary, secondary, ink }
    var kind: Kind
    var height: CGFloat = 44
    /// Fill the width it's offered: a sheet's or card's main action.
    var wide = false

    func makeBody(configuration: Configuration) -> some View {
        Pill(configuration: configuration, kind: kind, height: height, wide: wide)
    }

    private struct Pill: View {
        @Environment(\.isEnabled) private var enabled
        let configuration: Configuration
        let kind: Kind
        let height: CGFloat
        let wide: Bool

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
                .frame(maxWidth: wide ? .infinity : nil, minHeight: height)
                .background(fill, in: Capsule())
                .opacity(!enabled ? 0.45 : configuration.isPressed ? 0.85 : 1)
        }
    }
}

extension ButtonStyle where Self == PillButtonStyle {
    static var primary: PillButtonStyle { PillButtonStyle(kind: .primary) }
    static var secondary: PillButtonStyle { PillButtonStyle(kind: .secondary) }
    static var ink: PillButtonStyle { PillButtonStyle(kind: .ink) }
    /// A full-width pill, 46pt tall unless said.
    static func wide(_ kind: PillButtonStyle.Kind, height: CGFloat = 46) -> PillButtonStyle {
        PillButtonStyle(kind: kind, height: height, wide: true)
    }
}

/// The round terracotta "+" in page headers.
struct RoundAddButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "plus")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Theme.brandForeground)
                .frame(width: 44, height: 44)
                .background(Theme.brand, in: Circle())
                .shadow(color: .black.opacity(0.15), radius: 4, y: 2)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Add")
    }
}

// MARK: Page furniture

/// Page header as the web draws it: a Fraunces title with a muted line under it.
struct PageHeader<Trailing: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(Theme.serif(30))
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
            Text(title).font(Theme.serif(20)).foregroundStyle(Theme.foreground)
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

/// A recipe photo, or the empty plate (packages/ui Plate) while there's none.
struct RecipeImage: View {
    @Environment(AppModel.self) private var app
    let recipe: Recipe
    var thumbnail = true

    var body: some View {
        let placeholder = PlateView()
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
