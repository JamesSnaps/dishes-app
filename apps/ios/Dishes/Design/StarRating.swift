// Five stars with halves, for ratings stored 0–10 (cook_history.rating and
// member_ratings) — the web's StarRating (recipes/[id]/_components/star-rating.tsx).
//
//   StarRating(value: 7)                       // shows 3½ stars
//   StarRating(value: $rating, size: 32)       // tap or drag to set; left half of a star = half

import SwiftUI

struct StarRating: View {
    /// 0–10, or nil for "not rated".
    var value: Double?
    var size: CGFloat = 14
    /// Set to make it editable.
    var onChange: ((Double) -> Void)?
    /// The row's real width: SF Symbols' stars are wider than their point size.
    @State private var width: CGFloat = 0

    init(value: Double?, size: CGFloat = 14) {
        self.value = value
        self.size = size
    }

    init(value: Binding<Double?>, size: CGFloat = 28) {
        self.value = value.wrappedValue
        self.size = size
        self.onChange = { value.wrappedValue = $0 }
    }

    var body: some View {
        let stars = HStack(spacing: size * 0.15) {
            ForEach(0..<5, id: \.self) { i in
                Image(systemName: symbol(for: i))
                    .font(.system(size: size))
                    .foregroundStyle((value ?? 0) > Double(i) * 2 ? Color(hex: 0xF59E0B) : Theme.border)
            }
        }
        if let onChange {
            stars
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
                .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 0).onChanged { g in onChange(rating(at: g.location.x)) })
                .accessibilityElement()
                .accessibilityLabel("Rating")
                .accessibilityValue(value.map { "\(Format.amount(String($0 / 2)) ?? "") of 5 stars" } ?? "Not rated")
                .accessibilityAdjustableAction { direction in
                    let now = value ?? 0
                    onChange(direction == .increment ? min(10, now + 1) : max(0, now - 1))
                }
        } else {
            stars
                .accessibilityElement()
                .accessibilityLabel(value.map { "\(Format.amount(String($0 / 2)) ?? "") of 5 stars" } ?? "Not rated")
        }
    }

    private func symbol(for i: Int) -> String {
        let v = value ?? 0
        if v >= Double(i * 2 + 2) { return "star.fill" }
        if v >= Double(i * 2 + 1) { return "star.leadinghalf.filled" }
        return "star"
    }

    /// Where a touch lands, in half stars (1–10).
    private func rating(at x: CGFloat) -> Double {
        let starWidth = width > 0 ? width / 5 : size * 1.15
        let halves = Int((x / starWidth * 2).rounded(.up))
        return Double(min(10, max(1, halves)))
    }
}
