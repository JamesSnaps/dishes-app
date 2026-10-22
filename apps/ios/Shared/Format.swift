// Amounts and times as the screens show them, compiled into the app and the
// widget extension both.

import Foundation

enum Format {
    /// "600.000" → "600", "0.50" → "½". The full rules (unit promotion,
    /// metric/imperial) are lib/format-quantity.ts, to be ported with shared
    /// fixtures (TODO_MOBILE.md, C2).
    static func amount(_ raw: String?, scale: Double = 1) -> String? {
        guard let raw, let value = number(raw) else { return raw }
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

    /// The value of a stored amount: "1.5", "1/2", "1 1/2", "½" or "1½".
    /// Amounts are stored as typed, and Double("1/2") is nil, which left
    /// fractions unscaled. Mirrors parseAmount in lib/scale-ingredient.ts.
    static func number(_ raw: String) -> Double? {
        let s = raw.trimmingCharacters(in: .whitespaces)
        if let value = Double(s) { return value }
        let vulgar: [Character: Double] = [
            "⅛": 1.0 / 8, "⅕": 0.2, "¼": 0.25, "⅓": 1.0 / 3, "⅜": 3.0 / 8, "⅖": 0.4, "½": 0.5,
            "⅗": 0.6, "⅝": 5.0 / 8, "⅔": 2.0 / 3, "¾": 0.75, "⅘": 0.8, "⅞": 7.0 / 8,
        ]
        if let last = s.last, let frac = vulgar[last] {
            let head = s.dropLast().trimmingCharacters(in: .whitespaces)
            if head.isEmpty { return frac }
            if let whole = Int(head), whole >= 0 { return Double(whole) + frac }
            return nil
        }
        let parts = s.split(separator: " ", omittingEmptySubsequences: true)
        func fraction(_ part: Substring) -> Double? {
            let nd = part.split(separator: "/")
            guard nd.count == 2, let n = Int(nd[0]), let d = Int(nd[1]), d != 0 else { return nil }
            return Double(n) / Double(d)
        }
        if parts.count == 1 { return fraction(parts[0]) }
        if parts.count == 2, let whole = Int(parts[0]), let frac = fraction(parts[1]) {
            return Double(whole) + frac
        }
        return nil
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
