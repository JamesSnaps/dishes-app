// Nutrition, as the web's panel (recipes/[id]/_components/nutrition-panel.tsx):
// the orange-to-amber callout, collapsed to its kcal line until tapped (the
// open/closed choice is remembered on the device), then protein, carbs, fat,
// saturated fat, fibre, sugar and sodium in a grid — per serving, so the
// servings stepper doesn't change them — an "AI estimate" tag, and the heart-healthy badge
// (lib/heart-healthy.ts). With no figures yet, the AI estimates them from the
// ingredients (it needs a connection).

import DishesCore
import SwiftUI

struct NutritionPanel: View {
    @Environment(AppModel.self) private var app
    let recipe: Recipe
    @State private var estimating = false
    @AppStorage("recipeNutritionOpen") private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if recipe.hasNutrition {
                Button { withAnimation(.snappy) { open.toggle() } } label: { summary }
                    .buttonStyle(.plain)
                    .accessibilityHint(open ? "Hides the breakdown" : "Shows protein, carbs, fat and more")
            } else {
                HStack(spacing: 8) {
                    Image(systemName: "flame")
                    Text("Nutrition").font(.system(size: 15, weight: .semibold))
                    Spacer()
                }
                .foregroundStyle(Color(hex: 0x9A3412))
            }

            if recipe.hasNutrition, open {
                if recipe.nutritionSource == "ai" {
                    Label("AI estimate", systemImage: "sparkles")
                        .labelStyle(TightLabel())
                        .font(.system(size: 11, weight: .medium))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Color(hex: 0xFFEDD5), in: Capsule())
                        .foregroundStyle(Color(hex: 0xC2410C))
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 8)], spacing: 8) {
                    macro("Protein", recipe.proteinG, "g")
                    macro("Carbs", recipe.carbsG, "g")
                    macro("Fat", recipe.fatG, "g")
                    macro("Sat. fat", recipe.saturatedFatG, "g", warn: (recipe.saturatedFatG ?? 0) > 4)
                    macro("Fibre", recipe.fiberG, "g")
                    macro("Sugar", recipe.sugarG, "g")
                    macro("Sodium", recipe.sodiumMg, "mg", digits: 0)
                }
            } else if !recipe.hasNutrition {
                Text("No nutrition yet. The AI can estimate it from the ingredients.")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.mutedForeground)
                Button {
                    Task {
                        estimating = true
                        defer { estimating = false }
                        if await WebAction.run("ai.estimateNutrition", [.string(recipe.id)], done: "Nutrition estimated.") { await app.syncNow() }
                    }
                } label: {
                    Label(estimating ? "Estimating…" : "Estimate with AI", systemImage: "sparkles")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14)
                        .frame(height: 36)
                        .background(LinearGradient(colors: [Color(hex: 0xF97316), Color(hex: 0xF59E0B)],
                                                   startPoint: .leading, endPoint: .trailing),
                                    in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(estimating)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, recipe.hasNutrition && !open ? 12 : 16)
        .callout(Theme.orange50, Theme.amber50, border: Color(hex: 0xFED7AA).opacity(0.7))
    }

    /// 🔥 520 kcal per serving · Heart-healthy · Nutrition ⌄ — the always-visible line.
    private var summary: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: "flame").foregroundStyle(Color(hex: 0x9A3412))
            if let kcal = recipe.calories {
                Text("\(Int(kcal.rounded()))").font(.system(size: 20, weight: .bold)).foregroundStyle(Color(hex: 0x7C2D12))
                Text("kcal").font(.system(size: 14)).foregroundStyle(Theme.mutedForeground)
            }
            Text("per serving").font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
            Spacer(minLength: 6)
            if recipe.isHeartHealthy {
                Label("Heart-healthy", systemImage: "heart.text.square.fill")
                    .labelStyle(TightLabel())
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 3)
                    .background(LinearGradient(colors: [Color(hex: 0xF43F5E), Color(hex: 0xEC4899)],
                                               startPoint: .leading, endPoint: .trailing), in: Capsule())
            }
            if !open {
                Text("Nutrition").font(.system(size: 13, weight: .medium)).foregroundStyle(Color(hex: 0x9A3412))
            }
            Image(systemName: "chevron.down")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color(hex: 0x9A3412))
                .rotationEffect(.degrees(open ? 180 : 0))
        }
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private func macro(_ label: String, _ value: Double?, _ unit: String, digits: Int = 1, warn: Bool = false) -> some View {
        if let value {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.system(size: 11, weight: .medium)).foregroundStyle(Theme.mutedForeground)
                Text("\(value.formatted(.number.precision(.fractionLength(0...digits)))) \(unit)")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(warn ? Color(hex: 0xBE123C) : Theme.foreground)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(Theme.card.opacity(0.75), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
    }
}
