// What the app shows while the AI works, instead of a spinner and a line of
// text (DESIGN.md → AI at work; the web's components/ai-wait.tsx). Food is
// the colourful part: the household's own recipe photos spin in reels, empty
// plates steam, a photo develops. Every line of text is true — a fact the
// server sent, or what the person asked for. Motion stops under Reduce Motion.

import DishesCore
import SwiftUI

/// Four foods for the little plates.
private let miniFoods: [Color] = [Theme.brand, Theme.warning, Theme.success, Theme.plate]

/// Seconds since a fixed point, for looping animations driven by `TimelineView`.
private func clock(_ date: Date) -> Double { date.timeIntervalSinceReferenceDate }

// MARK: Small waits

/// A tiny conveyor of plates: the busy state of an AI button, in place of `ProgressView`.
struct PlateSpinner: View {
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        TimelineView(.animation(paused: still)) { context in
            let phase = still ? 0 : clock(context.date).truncatingRemainder(dividingBy: 1.8) / 1.8
            HStack(spacing: 4) {
                ForEach(0..<8, id: \.self) { i in
                    Circle().fill(Theme.card).frame(width: 12, height: 12)
                        .overlay(Circle().fill(miniFoods[i % 4]).frame(width: 8, height: 8))
                }
            }
            .fixedSize()
            .offset(x: -phase * 64)
            .frame(width: 40, height: 12, alignment: .leading)
            .clipped()
        }
        .accessibilityHidden(true)
    }
}

/// A busy AI button's label: the plate conveyor and what it's doing.
struct AIBusyLabel: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        HStack(spacing: 8) {
            PlateSpinner()
            Text(text)
        }
    }
}

/// Three plates hopping: the AI is writing a reply.
struct TypingPlates: View {
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        TimelineView(.animation(paused: still)) { context in
            HStack(spacing: 6) {
                ForEach(0..<3, id: \.self) { i in
                    let t = (clock(context.date) - Double(i) * 0.15).truncatingRemainder(dividingBy: 1.2) / 1.2
                    Circle().fill(Theme.muted).frame(width: 16, height: 16)
                        .overlay(Circle().fill(miniFoods[i]).frame(width: 10, height: 10))
                        .offset(y: still || t > 0.6 ? 0 : -5 * sin(t / 0.6 * .pi))
                }
            }
        }
        .accessibilityElement()
        .accessibilityLabel("Thinking")
    }
}

/// Cycles through the server's facts (all true); until they come it shows
/// `fallback`, which must be true too ("Looking through your recipes").
struct FactTicker: View {
    let facts: [String]
    let fallback: String
    @State private var index = 0

    var body: some View {
        let lines = facts.isEmpty ? [fallback] : facts
        Text(lines[index % lines.count])
            .font(.system(size: 14))
            .foregroundStyle(Theme.mutedForeground)
            .id(index % lines.count)
            .transition(.asymmetric(insertion: .move(edge: .bottom).combined(with: .opacity), removal: .opacity))
            .frame(maxWidth: .infinity, minHeight: 20, alignment: .leading)
            .clipped()
            .task(id: lines) {
                index = 0
                guard lines.count > 1 else { return }
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(3.2))
                    withAnimation(.easeOut(duration: 0.35)) { index += 1 }
                }
            }
            .accessibilityLabel(lines.joined(separator: ". "))
    }
}

// MARK: Plates

/// A dish's photo on a round plate; a new idea (no photo yet) gets the sparkle.
struct DishPlate: View {
    let url: URL?
    var isNew = false
    var size: CGFloat = 56

    var body: some View {
        Color.clear
            .overlay {
                if let url {
                    CachedImage(url: url) { PlateView() }
                } else {
                    PlateView()
                }
            }
            .frame(width: size, height: size)
            .clipShape(Circle())
            .overlay {
                if isNew && url == nil {
                    Image(systemName: "sparkles").font(.system(size: size * 0.3, weight: .semibold)).foregroundStyle(Theme.foreground)
                }
            }
            .shadow(color: Color(hex: 0x462D14).opacity(0.14), radius: 7, y: 6)
            .accessibilityHidden(true)
    }
}

/// An empty plate, dashed, breathing: a place where a dish will be.
struct EmptyPlate: View {
    var size: CGFloat = 56
    var delay: Double = 0
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        TimelineView(.animation(paused: still)) { context in
            let t = still ? 0.5 : (clock(context.date) + delay).truncatingRemainder(dividingBy: 2.4) / 2.4
            let breath = 0.5 - 0.5 * cos(t * 2 * .pi)
            Circle()
                .strokeBorder(Theme.input, style: StrokeStyle(lineWidth: 2, dash: [5, 4]))
                .background(Circle().fill(Theme.highlight))
                .frame(width: size, height: size)
                .scaleEffect(0.94 + 0.06 * breath)
                .opacity(0.5 + 0.5 * breath)
        }
        .accessibilityHidden(true)
    }
}

/// A slot-machine reel of the household's photos inside a round window.
/// `offset` starts each reel on a different photo and phase. With too few
/// photos the gaps are empty plates; with none, a dashed plate breathes.
struct PlateReel: View {
    let photos: [URL]
    var offset = 0
    var size: CGFloat = 56
    @Environment(\.accessibilityReduceMotion) private var still

    private var reel: [URL?] {
        (0..<max(6, min(photos.count, 8))).map { i in
            photos.count >= 4 || i % 2 == 0 ? photos[(i + offset * 3) % photos.count] : nil
        }
    }

    var body: some View {
        if photos.isEmpty {
            EmptyPlate(size: size, delay: Double(offset) * 0.3)
        } else {
            let reel = reel
            let period = Double(reel.count) * 0.16 + Double(offset) * 0.07
            TimelineView(.animation(paused: still)) { context in
                let phase = still ? 0 : (clock(context.date) + Double(offset) * 0.21).truncatingRemainder(dividingBy: period) / period
                VStack(spacing: 0) {
                    ForEach(Array((reel + reel).enumerated()), id: \.offset) { _, url in
                        Group {
                            if let url { CachedImage(url: url) { Theme.plate } } else { PlateView() }
                        }
                        .frame(width: size, height: size)
                        .clipped()
                    }
                }
                .offset(y: -phase * Double(reel.count) * size)
                .frame(width: size, height: size, alignment: .top)
                .clipped()
            }
            .background(Theme.plate)
            .clipShape(Circle())
            .accessibilityHidden(true)
        }
    }
}

/// An empty plate with steam rising: something's cooking that has no photo yet.
struct SteamPlate: View {
    var size: CGFloat = 56
    var delay: Double = 0
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        Circle()
            .strokeBorder(Theme.input, style: StrokeStyle(lineWidth: 2, dash: [5, 4]))
            .background(Circle().fill(Theme.highlight))
            .frame(width: size, height: size)
            .overlay(alignment: .top) {
                TimelineView(.animation(paused: still)) { context in
                    HStack(spacing: size * 0.06) {
                        ForEach(0..<3, id: \.self) { i in
                            let t = still ? 0.5 : (clock(context.date) - delay - Double(i) * 0.7).truncatingRemainder(dividingBy: 2.4) / 2.4
                            let u = t < 0 ? t + 1 : t
                            Wisp()
                                .stroke(Theme.mutedForeground, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                                .frame(width: size * 0.1, height: size * 0.42)
                                .scaleEffect(y: 0.8 + 0.35 * u, anchor: .bottom)
                                .offset(y: size * (0.08 - 0.24 * u))
                                .opacity(still ? 0.6 : (u < 0.35 ? u / 0.35 * 0.9 : 0.9 * (1 - (u - 0.35) / 0.65)))
                        }
                    }
                    .padding(.top, size * 0.18)
                }
            }
            .accessibilityHidden(true)
    }

    /// One curl of steam.
    private struct Wisp: Shape {
        func path(in r: CGRect) -> Path {
            var p = Path()
            let x = r.midX, w = r.width * 0.6, h = r.height
            p.move(to: CGPoint(x: x, y: r.maxY))
            p.addCurve(to: CGPoint(x: x, y: r.maxY - h * 0.38), control1: CGPoint(x: x - w, y: r.maxY - h * 0.12), control2: CGPoint(x: x + w, y: r.maxY - h * 0.25))
            p.addCurve(to: CGPoint(x: x, y: r.minY), control1: CGPoint(x: x - w, y: r.maxY - h * 0.55), control2: CGPoint(x: x + w, y: r.minY + h * 0.2))
            return p
        }
    }
}

/// A photo being made: the recipe's current photo (or an empty plate) blurs
/// in and out of focus like a print developing.
struct DevelopingPhoto: View {
    var url: URL?
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        TimelineView(.animation(paused: still)) { context in
            let t = still ? 0.5 : clock(context.date).truncatingRemainder(dividingBy: 6) / 6
            let focus = 0.5 - 0.5 * cos(t * 2 * .pi)
            Color.clear
                .overlay {
                    if let url { CachedImage(url: url) { PlateView() } } else { PlateView() }
                }
                .blur(radius: 18 - 13 * focus)
                .saturation(0.6 + 0.4 * focus)
                .scaleEffect(1.04 - 0.04 * focus)
        }
        .background(Theme.plate)
        .clipped()
        .accessibilityHidden(true)
    }
}

/// The caption on a photo being made.
struct PlatingUpCaption: View {
    var replacing = false

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "camera")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Theme.inkForeground)
                .frame(width: 36, height: 36)
                .background(Theme.ink, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(replacing ? "Plating up a new photo…" : "Plating up a photo…").font(.system(size: 14, weight: .semibold))
                Text("About 30 seconds. You can leave, we’ll let you know.").font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .shadow(color: .black.opacity(0.12), radius: 12, y: 6)
        .accessibilityElement(children: .combine)
    }
}

/// A recipe page being read in: its address, dots travelling to a plate that fills.
struct ReadingLink: View {
    let url: String
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        let host = URL(string: url)?.host()?.replacingOccurrences(of: "www.", with: "") ?? url
        HStack(spacing: 10) {
            Text(host).font(.system(size: 12)).foregroundStyle(Theme.mutedForeground).lineLimit(1)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(Theme.muted, in: Capsule())
                .frame(maxWidth: 190)
            TimelineView(.animation(paused: still)) { context in
                let now = clock(context.date)
                ZStack(alignment: .leading) {
                    ForEach(0..<3, id: \.self) { i in
                        let t = (now - Double(i) * 0.5).truncatingRemainder(dividingBy: 1.5) / 1.5
                        let u = t < 0 ? t + 1 : t
                        Circle().fill(Theme.foreground).frame(width: 6, height: 6)
                            .offset(x: still ? Double(i) * 16 : 36 * u)
                            .opacity(still ? 0.6 : (u < 0.2 ? u / 0.2 : u > 0.8 ? (1 - u) / 0.2 : 1))
                    }
                }
                .frame(width: 44, height: 10, alignment: .leading)
            }
            TimelineView(.animation(paused: still)) { context in
                let t = still ? 0.5 : clock(context.date).truncatingRemainder(dividingBy: 3) / 3
                let fill = t < 0.35 ? t / 0.35 : t < 0.8 ? 1 : 1 - (t - 0.8) / 0.2
                Circle().fill(Theme.card).frame(width: 64, height: 64)
                    .overlay(Circle().fill(Theme.plate).frame(width: 50, height: 50).scaleEffect(fill))
                    .shadow(color: Color(hex: 0x462D14).opacity(0.14), radius: 7, y: 6)
            }
        }
        .accessibilityHidden(true)
    }
}

/// Two muted lines where text is about to be.
private struct Skeleton: View {
    var delay: Double = 0
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        TimelineView(.animation(paused: still)) { context in
            let t = still ? 0.5 : (clock(context.date) + delay).truncatingRemainder(dividingBy: 1.6) / 1.6
            VStack(alignment: .leading, spacing: 8) {
                Capsule().fill(Theme.border).frame(height: 11).frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.trailing, 40)
                Capsule().fill(Theme.border).frame(width: 110, height: 9)
            }
            .opacity(0.75 + 0.25 * cos(t * 2 * .pi))
        }
        .accessibilityHidden(true)
    }
}

// MARK: Plan the week: reels that land

/// The week being drafted: a row per slot asked for, each with a reel of the
/// household's photos spinning until the AI writes that meal, when it lands —
/// the library dish's photo, or an empty plate with the sparkle for a new
/// idea. `slots` are the meals written so far; append them with animation.
struct PlanReels: View {
    struct Row: Hashable { var dayOfWeek: Int; var mealType: String }
    let rows: [Row]
    let photos: [URL]
    let slots: [APIClient.PlanSlot]
    let facts: [String]
    /// A slot's photo: the one the server sent, or the local recipe's.
    let photo: (APIClient.PlanSlot) -> URL?

    private static let days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

    var body: some View {
        let landed = Dictionary(slots.map { ("\($0.dayOfWeek)-\($0.mealType)", $0) }, uniquingKeysWith: { a, _ in a })
        let done = rows.filter { landed["\($0.dayOfWeek)-\($0.mealType)"] != nil }.count
        let multiPerDay = Set(rows.map(\.dayOfWeek)).count < rows.count
        VStack(alignment: .leading, spacing: 4) {
            Text(done == 0 ? "Planning your week…" : done < rows.count ? "\(done) of \(rows.count) planned…" : "Your week is planned")
                .font(Theme.serif(20))
                .contentTransition(.numericText())
            FactTicker(facts: facts, fallback: "Looking through your recipes")
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.element) { i, row in
                    let slot = landed["\(row.dayOfWeek)-\(row.mealType)"]
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(Self.days[row.dayOfWeek]).font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.brand)
                            if multiPerDay {
                                Text(row.mealType.uppercased()).font(.system(size: 10, weight: .semibold)).tracking(0.6)
                                    .foregroundStyle(Theme.mutedForeground)
                            }
                        }
                        .frame(width: 40, alignment: .leading)
                        ZStack {
                            if let slot {
                                DishPlate(url: photo(slot), isNew: slot.recipeId == nil)
                                    .transition(.scale(scale: 0.6).combined(with: .opacity))
                            } else {
                                PlateReel(photos: photos, offset: i)
                                    .transition(.opacity)
                            }
                        }
                        .frame(width: 56, height: 56)
                        ZStack(alignment: .leading) {
                            if let slot {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(slot.title).font(Theme.serif(16)).lineLimit(1)
                                    Text(slot.description).font(.system(size: 12)).foregroundStyle(Theme.mutedForeground).lineLimit(1)
                                    Text(slot.recipeId == nil ? "New idea" : "From your recipes")
                                        .font(.system(size: 11))
                                        .foregroundStyle(slot.recipeId == nil ? Theme.foreground : Theme.mutedForeground)
                                        .padding(.horizontal, 8).padding(.vertical, 2)
                                        .background(slot.recipeId == nil ? Theme.secondary : .clear, in: Capsule())
                                        .overlay(Capsule().strokeBorder(slot.recipeId == nil ? .clear : Theme.border))
                                }
                                .transition(.move(edge: .bottom).combined(with: .opacity))
                            } else {
                                Skeleton(delay: Double(i) * 0.2).transition(.opacity)
                            }
                        }
                        .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
                    }
                    .padding(.vertical, 10)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(slot.map { "\(Self.days[row.dayOfWeek]): \($0.title)" } ?? "\(Self.days[row.dayOfWeek]): still choosing")
                    if i < rows.count - 1 { Divider().overlay(Theme.border) }
                }
            }
            .padding(.top, 6)
            Text("Usually 15–30 seconds. Each day lands as soon as it’s chosen.")
                .font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                .padding(.top, 6)
        }
    }
}

// MARK: Ideas

/// Places for ideas, steaming until they come; streamed ideas take their place as they're written.
struct IdeaPlaces: View {
    let ideas: [APIClient.Concept]
    var count = 5
    var title = "Thinking up ideas…"
    /// What the person asked for, shown back to them.
    var asked: [String] = []
    /// The line underneath; say ideas arrive one by one only where they do.
    var note = "Usually 10–20 seconds."

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(ideas.isEmpty ? title : "\(min(ideas.count, count)) of \(count) ideas…")
                .font(Theme.serif(20))
            if !asked.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(asked, id: \.self) { a in
                        Text(a).font(.system(size: 12)).padding(.horizontal, 10).padding(.vertical, 5)
                            .background(Theme.secondary, in: Capsule())
                    }
                }
            }
            VStack(spacing: 0) {
                ForEach(0..<count, id: \.self) { i in
                    HStack(spacing: 12) {
                        ZStack {
                            if i < ideas.count {
                                DishPlate(url: nil, isNew: true).transition(.scale(scale: 0.6).combined(with: .opacity))
                            } else {
                                SteamPlate(delay: Double(i) * 0.45)
                            }
                        }
                        .frame(width: 56, height: 56)
                        ZStack(alignment: .leading) {
                            if i < ideas.count {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(ideas[i].title).font(Theme.serif(16)).lineLimit(1)
                                    Text(ideas[i].description).font(.system(size: 12)).foregroundStyle(Theme.mutedForeground).lineLimit(2)
                                }
                                .transition(.move(edge: .bottom).combined(with: .opacity))
                            } else {
                                Skeleton(delay: Double(i) * 0.2)
                            }
                        }
                        .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
                    }
                    .padding(.vertical, 10)
                    if i < count - 1 { Divider().overlay(Theme.border) }
                }
            }
            Text(note).font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: Writing a recipe

/// A ring round a plate that fills as the recipe is written.
struct WritingRing: View {
    let progress: RecipeProgress?
    var size: CGFloat = 56

    var body: some View {
        ZStack {
            Circle().fill(Theme.plate).padding(5)
            Circle().stroke(Theme.border, lineWidth: 3)
            Circle()
                .trim(from: 0, to: progress?.fraction ?? 0.05)
                .stroke(Theme.foreground, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.easeOut(duration: 0.7), value: progress?.fraction)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// A recipe being written: the dish it will be, then ingredients → method →
/// nutrition, ticked off as the AI reaches each part (the server streams where
/// it's got to). Ingredients appear by name as they're written.
struct RecipeWriting: View {
    let title: String
    var description: String?
    let progress: RecipeProgress?

    private enum Mark { case done, now, later }

    private func state(_ stage: RecipeProgress.Stage) -> Mark {
        let order: [RecipeProgress.Stage] = [.grounding, .ingredients, .method, .nutrition]
        // Before the first word arrives it's on the ingredients.
        let current = progress.flatMap { order.firstIndex(of: $0.stage) } ?? 1
        let i = order.firstIndex(of: stage)!
        return i < current ? .done : i == current ? .now : .later
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 16) {
                SteamPlate(size: 96)
                VStack(alignment: .leading, spacing: 4) {
                    Text("WRITING").font(Theme.overline).tracking(0.9).foregroundStyle(Theme.mutedForeground)
                    Text(title).font(Theme.serif(24)).fixedSize(horizontal: false, vertical: true)
                    if let description, !description.isEmpty {
                        Text(description).font(Theme.serif(14, weight: .medium, italic: true)).foregroundStyle(Theme.mutedForeground).lineLimit(2)
                    }
                }
            }
            VStack(spacing: 0) {
                if progress?.stage == .grounding { row(.now, "Reading real recipes for reference") }
                row(state(.ingredients), "Ingredients") {
                    let names = progress?.ingredients ?? []
                    if !names.isEmpty {
                        FlowLayout(spacing: 6) {
                            ForEach(Array(names.suffix(6).enumerated()), id: \.offset) { _, n in
                                Text(n).font(.system(size: 12)).padding(.horizontal, 10).padding(.vertical, 4)
                                    .background(Theme.secondary, in: Capsule())
                            }
                            if names.count > 6 {
                                Text("+ \(names.count - 6)").font(.system(size: 12)).padding(.horizontal, 10).padding(.vertical, 4)
                                    .background(Theme.secondary, in: Capsule())
                            }
                        }
                    }
                }
                Divider().overlay(Theme.border)
                row(state(.method), progress?.stage == .method && (progress?.steps ?? 0) > 0 ? "Method · step \(progress!.steps)" : "Method")
                Divider().overlay(Theme.border)
                row(state(.nutrition), "Nutrition")
            }
            .animation(.easeOut(duration: 0.3), value: progress)
            if progress?.revising == true {
                Text("Second pass: the first draft missed the heart-healthy targets, so it’s being revised.")
                    .font(.system(size: 14)).foregroundStyle(Theme.warning)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(Theme.warningTint, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            Text("Usually about a minute.").font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
        }
    }

    private func row(_ state: Mark, _ label: String, @ViewBuilder detail: () -> some View = { EmptyView() }) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Group {
                switch state {
                case .done:
                    Image(systemName: "checkmark").font(.system(size: 11, weight: .heavy)).foregroundStyle(Theme.success)
                        .frame(width: 24, height: 24).background(Theme.successTint, in: Circle())
                case .now:
                    PulsingRing()
                case .later:
                    Circle().strokeBorder(Theme.input, style: StrokeStyle(lineWidth: 2, dash: [4, 3])).frame(width: 24, height: 24)
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                Text(label).font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(state == .later ? Theme.mutedForeground : Theme.foreground)
                detail()
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 12)
        .accessibilityElement(children: .combine)
        .accessibilityValue(state == .done ? "Done" : state == .now ? "Writing now" : "")
    }

    private struct PulsingRing: View {
        @Environment(\.accessibilityReduceMotion) private var still
        var body: some View {
            TimelineView(.animation(paused: still)) { context in
                let t = still ? 0.5 : clock(context.date).truncatingRemainder(dividingBy: 1.6) / 1.6
                Circle().strokeBorder(Theme.foreground, lineWidth: 2).frame(width: 24, height: 24)
                    .opacity(0.75 + 0.25 * cos(t * 2 * .pi))
            }
        }
    }
}
