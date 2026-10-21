// Amounts and times as the screens show them, compiled into the app and the
// widget extension both.

import Foundation

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
