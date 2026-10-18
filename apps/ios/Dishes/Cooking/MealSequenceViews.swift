// A scheduled meal cooked as one sequence (MealSequence in DishesCore, the
// web's meal-cooking.tsx): the step's time and what else is due with it, the
// screens for steps that aren't one dish's (a combined prep step, a note,
// serving), and the whole schedule to look ahead or jump to.

import DishesCore
import SwiftUI

extension CookSession {
    typealias Cue = APIClient.MealClock.Cue

    /// Walking the meal as one sequence: it has a schedule, and you're not
    /// reading one dish's whole recipe.
    var inSequence: Bool { !cues.isEmpty && !dishView }
    var seqIndex: Int { MealSequence.index(of: position, in: cues) }
    var cue: Cue? { cues.indices.contains(seqIndex) ? cues[seqIndex] : nil }

    /// Go to a place in the sequence: its dish comes up at its step.
    func goTo(_ index: Int) {
        let cues = self.cues
        guard cues.indices.contains(index) else { return }
        position = cues[index].id
        dishView = false
        for step in MealSequence.steps(of: cues[index]) { steps[step.recipeId] = step.stepIndex }
        if let anchor = MealSequence.anchor(cues, at: index),
           let dish = request.dishes.firstIndex(where: { $0.recipe.id == anchor }) {
            dishIndex = dish
        }
    }

    /// One dish's whole recipe, out of the sequence; your place in it is kept.
    func showDish(_ index: Int) {
        dishView = !cues.isEmpty
        dishIndex = index
    }

    func title(of recipeId: String?) -> String? {
        request.dishes.first { $0.recipe.id == recipeId }?.recipe.title
    }

    /// "Lamb · step 3 of 6", "Prep for 2 dishes", "Note", "Serve".
    func label(of cue: Cue) -> String {
        if let covers = cue.covers, !covers.isEmpty { return "Prep for \(Set(covers.map(\.recipeId)).count) dishes" }
        if cue.id == "serve" { return "Serve" }
        if let dish = request.dishes.first(where: { $0.recipe.id == cue.recipeId })?.recipe {
            if let step = cue.stepIndex { return "\(dish.title) · step \(step + 1) of \(dish.steps.count)" }
            return "\(dish.title) · note"
        }
        return "Note"
    }
}

/// Above the step: when it's due, anything else due at the same time, and what's next.
struct SequenceDueView: View {
    @Bindable var session: CookSession

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            let now = context.date.timeIntervalSince1970 * 1000
            let cues = session.cues
            let index = session.seqIndex
            if let cue = session.cue {
                let due = MealSequence.due(cue.at, now: now)
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        HStack(spacing: 6) {
                            Image(systemName: "alarm")
                            Text(MealStartSheet.hhmm(Date(timeIntervalSince1970: cue.at / 1000)))
                                .font(.system(size: 15, weight: .bold).monospacedDigit())
                            Text(due.text)
                                .font(.system(size: 12, weight: .semibold))
                                .padding(.horizontal, 7).padding(.vertical, 2)
                                .foregroundStyle(due.tone == .now ? .white : due.tone == .late ? Color(hex: 0xBE123C) : Color(hex: 0x9A3412))
                                .background {
                                    if due.tone == .now { Capsule().fill(Theme.brandGradient) }
                                    else { Capsule().fill(due.tone == .late ? Color(hex: 0xFFE4E6) : Color.white.opacity(0.8)) }
                                }
                        }
                        .foregroundStyle(Color(hex: 0x7C2D12))
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .callout(Theme.orange50, Theme.amber50, border: Color(hex: 0xFED7AA).opacity(0.8))
                        Text(session.label(of: cue))
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Theme.brandDeep)
                            .lineLimit(1)
                    }
                    let others = MealSequence.alsoNow(cues, at: index)
                    if !others.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 6) {
                                Text("ALSO NOW").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.mutedForeground)
                                ForEach(others, id: \.cue.id) { other in
                                    Button { withAnimation(.snappy) { session.goTo(other.index) } } label: {
                                        Text(session.label(of: other.cue))
                                            .font(.system(size: 12, weight: .medium))
                                            .padding(.horizontal, 10).frame(height: 26)
                                            .background(Theme.background, in: Capsule())
                                            .overlay(Capsule().strokeBorder(Color(hex: 0xFDBA74)))
                                    }
                                    .buttonStyle(.plain)
                                    .foregroundStyle(Theme.foreground)
                                }
                            }
                        }
                    }
                    if cues.indices.contains(index + 1) {
                        let next = cues[index + 1]
                        Button { withAnimation(.snappy) { session.goTo(index + 1) } } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "arrow.right").font(.system(size: 11, weight: .bold))
                                Text("Next").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.mutedForeground)
                                Text(MealStartSheet.hhmm(Date(timeIntervalSince1970: next.at / 1000)))
                                    .font(.system(size: 12, weight: .bold).monospacedDigit())
                                Text(next.id == "serve" ? "Serve" : (session.title(of: next.recipeId).map { "\($0): " } ?? "") + next.text)
                                    .font(.system(size: 12))
                                    .foregroundStyle(Theme.mutedForeground)
                                    .lineLimit(1)
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 10).padding(.vertical, 6)
                            .background(Theme.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(Theme.foreground)
                    }
                }
            }
        }
    }
}

/// A step that isn't one dish's: a combined prep step (each dish's step it
/// does, in their own words), a coordinating note, or serving.
struct CueCardView: View {
    @Bindable var session: CookSession
    var size: CGFloat
    var finish: () -> Void

    var body: some View {
        if let cue = session.cue {
            let serve = cue.id == "serve"
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: serve ? "fork.knife" : cue.covers?.isEmpty == false ? "list.number" : "exclamationmark.bubble")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 40, height: 40)
                        .background(Theme.brandGradient, in: Circle())
                    Text(serve ? "Everything should be ready — time to serve." : cue.text)
                        .font(.system(size: size * 0.85, weight: .medium, design: .rounded))
                }
                if let covers = cue.covers, !covers.isEmpty {
                    ForEach(covers, id: \.self) { step in
                        let dish = session.request.dishes.firstIndex { $0.recipe.id == step.recipeId }
                        let recipe = dish.map { session.request.dishes[$0].recipe }
                        VStack(alignment: .leading, spacing: 4) {
                            Button {
                                if let dish {
                                    session.steps[step.recipeId] = step.stepIndex
                                    session.showDish(dish)
                                }
                            } label: {
                                Text("\(recipe?.title ?? "Dish") · step \(step.stepIndex + 1)".uppercased())
                                    .font(.system(size: 12, weight: .bold))
                                    .foregroundStyle(Theme.brandDeep)
                            }
                            .buttonStyle(.plain)
                            Text(recipe.flatMap { $0.steps.indices.contains(step.stepIndex) ? $0.steps[step.stepIndex].instruction : nil } ?? "")
                                .font(.system(size: max(16, size * 0.55)))
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .card()
                    }
                }
                if serve {
                    Button(action: finish) { Label("Finish and review the meal", systemImage: "checkmark.circle") }
                        .buttonStyle(.brand)
                }
            }
            .padding(16)
            .callout(Theme.orange50, Theme.rose50, border: Color(hex: 0xFED7AA).opacity(0.7))
        }
    }
}

/// The meal's whole schedule: done steps faded, yours highlighted; tap one to go there.
struct MealScheduleList: View {
    @Environment(\.dismiss) private var dismiss
    @Bindable var session: CookSession

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                List {
                    ForEach(Array(session.cues.enumerated()), id: \.element.id) { i, cue in
                        let current = i == session.seqIndex && session.inSequence
                        Button {
                            withAnimation(.snappy) { session.goTo(i) }
                            dismiss()
                        } label: {
                            HStack(alignment: .firstTextBaseline, spacing: 12) {
                                Text(MealStartSheet.hhmm(Date(timeIntervalSince1970: cue.at / 1000)))
                                    .font(.system(size: 15, weight: .bold).monospacedDigit())
                                    .foregroundStyle(current ? .white : Theme.brandDeep)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(session.label(of: cue))
                                        .font(.system(size: 12, weight: .semibold))
                                        .foregroundStyle(current ? .white.opacity(0.85) : Theme.mutedForeground)
                                    Text(cue.id == "serve" ? "Serve" : cue.text)
                                        .font(.system(size: 15))
                                        .foregroundStyle(current ? .white : Theme.foreground)
                                }
                            }
                            .opacity(i < session.seqIndex && session.inSequence ? 0.45 : 1)
                        }
                        .listRowBackground(current ? AnyView(Theme.brandGradient) : AnyView(Color.clear))
                        .id(cue.id)
                    }
                }
                .listStyle(.plain)
                .onAppear { if let id = session.cue?.id { proxy.scrollTo(id, anchor: .center) } }
            }
            .navigationTitle("Whole schedule").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.bold() } }
        }
    }
}
