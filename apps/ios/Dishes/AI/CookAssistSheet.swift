// "Ask about this step" in cooking mode, as the web's: a short chat about the
// step on screen ("can I use butter instead?", "how do I know it's done?"),
// with the whole recipe as context. The answer streams in as it's written.

import DishesCore
import SwiftUI

struct CookAssistSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let dish: CookDish
    let stepIndex: Int

    @State private var messages: [APIClient.AssistMessage] = []
    @State private var draft = ""
    @State private var answering = false
    @State private var error: String?
    @FocusState private var focused: Bool

    private var step: RecipeStep? { dish.recipe.steps.indices.contains(stepIndex) ? dish.recipe.steps[stepIndex] : nil }

    private static let starters = ["What can I use instead?", "How do I know it’s done?", "Can I do this ahead?", "Why this step?"]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollViewReader { scroller in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 14) {
                            if let step {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("STEP \(stepIndex + 1) · \(dish.recipe.title.uppercased())")
                                        .font(.system(size: 12, weight: .semibold)).tracking(0.6)
                                        .foregroundStyle(Theme.brandDeep)
                                    Text(step.instruction).font(.system(size: 15))
                                }
                                .padding(14)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Theme.orange50, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            }
                            if messages.isEmpty {
                                FlowLayout(spacing: 8) {
                                    ForEach(Self.starters, id: \.self) { q in
                                        Button(q) { Task { await ask(q) } }
                                            .font(.system(size: 14))
                                            .padding(.horizontal, 12)
                                            .frame(height: 34)
                                            .foregroundStyle(Theme.foreground)
                                            .background(Theme.violet50, in: Capsule())
                                            .buttonStyle(.plain)
                                    }
                                }
                            }
                            ForEach(Array(messages.enumerated()), id: \.offset) { index, message in
                                bubble(message).id(index)
                            }
                            if let error {
                                Text(error).font(.system(size: 14)).foregroundStyle(Theme.destructive)
                            }
                        }
                        .padding(18)
                    }
                    .onChange(of: messages) { _, list in
                        withAnimation { scroller.scrollTo(list.count - 1, anchor: .bottom) }
                    }
                }
                HStack(spacing: 10) {
                    TextField("Ask about this step…", text: $draft, axis: .vertical)
                        .lineLimit(1...4)
                        .focused($focused)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.border))
                        .onSubmit { send() }
                    Button(action: send) {
                        Image(systemName: answering ? "ellipsis" : "arrow.up")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 40, height: 40)
                            .background(Theme.brandGradient, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .disabled(answering || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding(14)
                .background(Theme.card)
                .overlay(alignment: .top) { Rectangle().fill(Theme.border).frame(height: 1) }
            }
            .background(Theme.background)
            .navigationTitle("Ask about this step")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    private func bubble(_ message: APIClient.AssistMessage) -> some View {
        let mine = message.role == "user"
        return HStack {
            if mine { Spacer(minLength: 40) }
            Text(LocalizedStringKey(message.content.isEmpty ? "…" : message.content))
                .font(.system(size: 15))
                .padding(12)
                .foregroundStyle(mine ? .white : Theme.foreground)
                .background(mine ? AnyShapeStyle(Theme.brandGradient) : AnyShapeStyle(Theme.muted),
                            in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .textSelection(.enabled)
            if !mine { Spacer(minLength: 40) }
        }
    }

    private func send() {
        let question = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !question.isEmpty, !answering else { return }
        draft = ""
        Task { await ask(question) }
    }

    private func ask(_ question: String) async {
        error = nil
        answering = true
        defer { answering = false }
        messages.append(.init(role: "user", content: question))
        let history = messages
        messages.append(.init(role: "assistant", content: ""))
        let reply = messages.count - 1

        let recipe = dish.recipe
        let used = recipe.ingredients.filter { step?.ingredientIds.contains($0.id) == true }
        func item(_ i: Ingredient) -> APIClient.CookAssistContext.Ingredient {
            .init(amount: Format.quantity(i.amount, nil, scale: dish.scale).nilIfEmpty, unit: i.unit, name: i.name)
        }
        let context = APIClient.CookAssistContext(
            recipeTitle: recipe.title,
            stepNumber: stepIndex + 1,
            stepInstruction: step?.instruction ?? "",
            stepIngredients: used.map(item),
            allIngredients: recipe.ingredients.map(item),
            allSteps: recipe.steps.enumerated().map { .init(number: $0.offset + 1, instruction: $0.element.instruction) },
            servingsSummary: dish.scale == 1 ? nil : "Scaled ×\(Format.amount(String(dish.scale)) ?? "")",
            messages: history)
        do {
            for try await chunk in app.api.cookAssist(context) {
                messages[reply].content += chunk
            }
            if messages[reply].content.isEmpty { messages[reply].content = "No answer came back." }
        } catch {
            messages.remove(at: reply)
            self.error = ConciergeSheet.explain(error)
        }
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
