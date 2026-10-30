// "Ask about this step" in cooking mode, as the web's: a short chat about the
// step on screen ("can I use butter instead?", "how do I know it's done?"),
// with the whole recipe as context. The answer streams in as it's written.
// Each conversation is saved after every answer (cook_assist_threads, shared
// with the web), and earlier ones for the step show above it. The answer
// comes from the on-device model when it can (CookAssist, TODO_MOBILE.md D3),
// the server otherwise.

import DishesCore
import SwiftUI

/// One conversation about a step; `id` once it's been saved.
struct AssistThread: Decodable, Identifiable {
    var id: String?
    var stepNumber: Int?
    var messages: [APIClient.AssistMessage] = []
}

struct CookAssistSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let session: CookSession
    let dish: CookDish
    let stepIndex: Int

    @State private var previous: [AssistThread] = []
    @State private var draft = ""
    @State private var answering = false
    @State private var error: String?
    /// Where the last answer came from, for the line under it.
    @State private var engine: AIEngine?
    @FocusState private var focused: Bool

    static func key(recipeId: String, stepIndex: Int) -> String { "\(recipeId)#\(stepIndex)" }
    private var key: String { Self.key(recipeId: dish.recipe.id, stepIndex: stepIndex) }
    /// The conversation open now, kept on the cook so it outlives the sheet.
    private var messages: [APIClient.AssistMessage] { session.assist[key]?.messages ?? [] }

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
                                        .foregroundStyle(Theme.brand)
                                    Text(step.instruction).font(.system(size: 15))
                                }
                                .padding(14)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Theme.highlight, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            }
                            if !previous.isEmpty {
                                previousSection
                            }
                            if messages.isEmpty {
                                FlowLayout(spacing: 8) {
                                    ForEach(Self.starters, id: \.self) { q in
                                        Button(q) { Task { await ask(q) } }
                                            .font(.system(size: 14))
                                            .padding(.horizontal, 12)
                                            .frame(height: 34)
                                            .foregroundStyle(Theme.foreground)
                                            .background(Theme.muted, in: Capsule())
                                            .buttonStyle(.plain)
                                    }
                                }
                            }
                            ForEach(Array(messages.enumerated()), id: \.offset) { index, message in
                                bubble(message).id(index)
                            }
                            if engine == .device, messages.last?.role == "assistant" {
                                Label("Answered on this \(UIDevice.current.model)", systemImage: "apple.intelligence")
                                    .font(.system(size: 12))
                                    .foregroundStyle(Theme.mutedForeground)
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
                            .foregroundStyle(Theme.brandForeground)
                            .frame(width: 40, height: 40)
                            .background(Theme.brand, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .disabled(answering || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding(14)
                .background(Theme.card)
                .overlay(alignment: .top) { Rectangle().fill(Theme.border).frame(height: 1) }
            }
            .background(Theme.background)
            .task { await loadPrevious() }
            .navigationTitle("Ask about this step")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    /// Earlier conversations about this step, from this cook or another day.
    private var previousSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("EARLIER")
                .font(.system(size: 12, weight: .semibold)).tracking(0.6)
                .foregroundStyle(Theme.mutedForeground)
            ForEach(previous) { thread in
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(thread.messages.enumerated()), id: \.offset) { _, message in
                        bubble(message)
                    }
                    if let id = thread.id {
                        Button(role: .destructive) { Task { await delete(id) } } label: {
                            Label("Delete", systemImage: "trash").font(.system(size: 13))
                        }
                        .buttonStyle(.borderless)
                    }
                }
                .padding(12)
                .background(Theme.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            if !messages.isEmpty {
                Text("NOW")
                    .font(.system(size: 12, weight: .semibold)).tracking(0.6)
                    .foregroundStyle(Theme.mutedForeground)
                    .padding(.top, 4)
            }
        }
    }

    private func bubble(_ message: APIClient.AssistMessage) -> some View {
        let mine = message.role == "user"
        return HStack {
            if mine { Spacer(minLength: 40) }
            Group {
                // The reply hasn't started yet: plates hop while it thinks.
                if !mine && message.content.isEmpty {
                    TypingPlates().padding(.vertical, 2)
                } else {
                    Text(LocalizedStringKey(message.content)).textSelection(.enabled)
                }
            }
            .font(.system(size: 15))
            .padding(12)
            .foregroundStyle(mine ? .white : Theme.foreground)
            .background(mine ? AnyShapeStyle(Theme.brand) : AnyShapeStyle(Theme.muted),
                        in: RoundedRectangle(cornerRadius: 14, style: .continuous))
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
        // Captured, not read from self: the answer keeps arriving (and is
        // saved) if the sheet is closed or the step moves on meanwhile.
        let (key, recipeId, stepNumber, session) = (key, dish.recipe.id, stepIndex + 1, session)
        var thread = session.assist[key] ?? AssistThread()
        thread.messages.append(.init(role: "user", content: question))
        let history = thread.messages
        thread.messages.append(.init(role: "assistant", content: ""))
        session.assist[key] = thread
        let reply = thread.messages.count - 1

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
        let api = app.api
        do {
            for try await event in CookAssist.ask(context, serverReady: AIContext.cached?.configured == true,
                                                       server: { CookAssist.onServer(context, api: api) }) {
                switch event {
                case .engine(let source, _): engine = source
                case .restart: session.assist[key]?.messages[reply].content = ""
                case .text(let chunk): session.assist[key]?.messages[reply].content += chunk
                }
            }
            if session.assist[key]?.messages[reply].content.isEmpty == true {
                session.assist[key]?.messages[reply].content = "No answer came back."
            }
        } catch {
            session.assist[key]?.messages.remove(at: reply)
            if session.assist[key]?.messages.last?.role == "user" { session.assist[key]?.messages.removeLast() }
            draft = question
            self.error = ConciergeSheet.explain(error)
            return
        }
        await save(key: key, recipeId: recipeId, stepNumber: stepNumber)
    }

    /// The conversation so far, to the server: a new thread on its first
    /// answer, the same one after that. Best effort — a failed save leaves it
    /// on the cook and the next answer tries again.
    private func save(key: String, recipeId: String, stepNumber: Int) async {
        guard let thread = session.assist[key], !thread.messages.isEmpty,
              let messages = try? JSONValue(encoding: thread.messages) else { return }
        struct Saved: Decodable { var id: String }
        do {
            if let id = thread.id {
                try await app.api.run("cookAssist.update", [.string(id), messages])
            } else {
                let saved = try await app.api.action("cookAssist.save",
                                                     [.string(recipeId), .number(Double(stepNumber)), messages], as: Saved.self)
                session.assist[key]?.id = saved.id
            }
        } catch {}
    }

    private func loadPrevious() async {
        guard let all = try? await app.api.action("cookAssist.list", [.string(dish.recipe.id)], as: [AssistThread].self) else { return }
        let open = session.assist[key]?.id
        previous = all.filter { $0.stepNumber == stepIndex + 1 && $0.id != open && !$0.messages.isEmpty }
    }

    private func delete(_ id: String) async {
        previous.removeAll { $0.id == id }
        try? await app.api.run("cookAssist.delete", [.string(id)])
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
