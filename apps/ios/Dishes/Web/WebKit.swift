// What the website's screens in the app share: their data comes from the
// web's own actions (POST /api/v1/actions/{name}, apps/web/lib/api/v1-actions.ts),
// so they need a connection; `Remote` loads one and keeps it, and `WebPage`
// is the scrolling page in the app's style with loading and error states.
//
//   @State private var data = Remote<PantryList>("pantry.list")
//   WebPage(title: "Pantry", data: data) { list in … }

import DishesCore
import SwiftUI

/// A value from one of the web's actions, loaded on appear and on pull-to-refresh.
@MainActor @Observable
final class Remote<T: Decodable & Sendable> {
    let action: String
    var args: [JSONValue]
    private(set) var value: T?
    private(set) var error: String?
    private(set) var loading = false

    init(_ action: String, _ args: [JSONValue] = []) {
        self.action = action
        self.args = args
    }

    func load() async {
        loading = true
        defer { loading = false }
        do {
            value = try await AppModel.shared.api.action(action, args, as: T.self)
            error = nil
        } catch {
            if value == nil { self.error = WebAction.explain(error) }
        }
    }
}

enum WebAction {
    /// Runs an action for its effect; a toast says why when it fails. Answers whether it worked.
    @MainActor @discardableResult
    static func run(_ name: String, _ args: [JSONValue] = [], done: String? = nil) async -> Bool {
        do {
            try await AppModel.shared.api.run(name, args)
            if let done { AppModel.shared.toast = done }
            return true
        } catch {
            AppModel.shared.toast = explain(error)
            return false
        }
    }

    static func explain(_ error: Error) -> String {
        if case APIError.http(_, _, let message) = error { return message }
        if (error as? URLError)?.code == .timedOut { return "That took too long. Try again in a moment." }
        if case APIError.signedOut = error { return "You’re signed out." }
        return "Couldn’t reach Dishes. Check your connection."
    }
}

/// A JSON argument from any Encodable value (for structs posted to actions).
func arg<T: Encodable>(_ value: T) -> JSONValue {
    (try? JSONValue(encoding: value)) ?? .null
}

/// The web screens' page: header, the content once loaded, pull to refresh.
struct WebPage<T: Decodable & Sendable, Trailing: View, Content: View>: View {
    @Environment(\.horizontalSizeClass) private var width
    let title: String
    var subtitle: String?
    let data: Remote<T>
    @ViewBuilder var trailing: Trailing
    @ViewBuilder var content: (T) -> Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                PageHeader(title: title, subtitle: subtitle) { trailing }
                if let value = data.value {
                    content(value)
                } else if let error = data.error {
                    VStack(alignment: .leading, spacing: 10) {
                        Label("Couldn’t load this", systemImage: "wifi.exclamationmark")
                            .font(.system(size: 15, weight: .semibold))
                        Text(error).font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                        Button("Try again") { Task { await data.load() } }.buttonStyle(.outline)
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card()
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(40)
                }
            }
            .padding(.horizontal, width == .regular ? 28 : 16)
            .padding(.vertical, 20)
            .frame(maxWidth: 900)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await data.load() }
        .task { if data.value == nil { await data.load() } }
    }
}

extension WebPage where Trailing == EmptyView {
    init(title: String, subtitle: String? = nil, data: Remote<T>, @ViewBuilder content: @escaping (T) -> Content) {
        self.init(title: title, subtitle: subtitle, data: data, trailing: { EmptyView() }, content: content)
    }
}

/// A section label with an optional trailing action, the web's small caps heading.
struct WebSection<Content: View>: View {
    let title: String
    var action: (label: String, icon: String, run: () -> Void)?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title.uppercased())
                    .font(.system(size: 12, weight: .semibold)).tracking(0.6)
                    .foregroundStyle(Theme.mutedForeground)
                Spacer()
                if let action {
                    Button(action: action.run) {
                        Label(action.label, systemImage: action.icon).font(.system(size: 13, weight: .semibold))
                    }
                    .foregroundStyle(Theme.brand)
                }
            }
            content
        }
    }
}

/// Rows inside one card, divided like the web's lists.
struct CardList<Item: Identifiable, Row: View>: View {
    let items: [Item]
    @ViewBuilder var row: (Item) -> Row

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                if index > 0 { Rectangle().fill(Theme.border).frame(height: 1) }
                row(item)
            }
        }
        .card()
    }
}

/// A tinted stat tile: big number, small label.
struct StatTile: View {
    let value: String
    let label: String
    var tint: Color = Theme.orange50

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value).font(.system(size: 24, weight: .bold, design: .rounded)).foregroundStyle(Theme.foreground)
            Text(label).font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.mutedForeground)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

/// A simple text prompt sheet: one field and Save.
struct TextPromptSheet: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    var placeholder = ""
    @State var text: String
    var multiline = false
    var save: (String) async -> Bool

    var body: some View {
        NavigationStack {
            Form {
                if multiline {
                    TextField(placeholder, text: $text, axis: .vertical).lineLimit(4...12)
                } else {
                    TextField(placeholder, text: $text)
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task { if await save(text.trimmingCharacters(in: .whitespacesAndNewlines)) { dismiss() } }
                    }
                    .bold()
                    .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .presentationDetents([.medium])
    }
}

extension String {
    /// "2026-10-17T11:40:00.000Z" → a Date.
    var isoDate: Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: self) ?? ISO8601DateFormatter().date(from: self)
    }
}
