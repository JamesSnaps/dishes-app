// My Notes, as the web's /notes: free-form notes for the household, each
// optionally about a recipe ("Get guanciale from the deli"). The recipe page's
// menu writes one about that recipe.

import DishesCore
import SwiftUI

struct NoteRow: Decodable, Sendable, Identifiable, Hashable {
    var id: String
    var title: String
    var body: String
    var updatedAt: String
    var recipeId: String?
    var recipeTitle: String?
    /// The member who wrote it (nil from servers before v1.45.0).
    var authorId: String?
}

struct NotesScreen: View {
    @State private var data = Remote<[NoteRow]>("notes.list")
    @State private var editing: NoteEdit?
    @State private var search = ""

    var body: some View {
        WebPage(title: "Notes", subtitle: "Reminders, tips and tweaks for the household.", data: data, trailing: {
            Button { editing = NoteEdit(note: nil, recipeId: nil) } label: {
                Label("New note", systemImage: "plus")
                    .font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
                    .padding(.horizontal, 14).frame(height: 38)
                    .background(Theme.brand, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            }
            .buttonStyle(.plain)
        }) { notes in
            if !notes.isEmpty { SearchField(prompt: "Search notes…", text: $search) }
            let shown = notes.filter { search.isEmpty || "\($0.title) \($0.body) \($0.recipeTitle ?? "")".localizedCaseInsensitiveContains(search) }
            if shown.isEmpty {
                EmptyBox(emoji: "📝", message: notes.isEmpty ? "No notes yet" : "No notes match")
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 12, alignment: .top)], spacing: 12) {
                ForEach(shown) { note in
                    Button { editing = NoteEdit(note: note, recipeId: note.recipeId) } label: {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(note.title).font(.system(size: 16, weight: .bold)).multilineTextAlignment(.leading)
                            if !note.body.isEmpty {
                                Text(note.body).font(.system(size: 14)).foregroundStyle(Theme.foreground.opacity(0.8))
                                    .lineLimit(6).multilineTextAlignment(.leading)
                            }
                            HStack {
                                if let title = note.recipeTitle {
                                    Label(title, systemImage: "book").labelStyle(TightLabel())
                                        .font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.brandDeep).lineLimit(1)
                                }
                                Spacer()
                                if let date = note.updatedAt.isoDate {
                                    Text(date.formatted(date: .abbreviated, time: .omitted))
                                        .font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
                                }
                            }
                        }
                        .padding(16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .callout(Theme.amber50, Theme.orange50, border: Color(hex: 0xFDE68A).opacity(0.7))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.foreground)
                }
            }
        }
        .sheet(item: $editing) { edit in
            NoteSheet(edit: edit) { await data.load() }
        }
    }
}

struct NoteEdit: Identifiable {
    let id = UUID()
    var note: NoteRow?
    var recipeId: String?
    var recipeTitle: String?
}

/// Write or edit a note.
struct NoteSheet: View {
    @Environment(\.dismiss) private var dismiss
    let edit: NoteEdit
    var saved: () async -> Void
    @State private var title = ""
    @State private var text = ""
    @State private var confirmDelete = false

    var body: some View {
        NavigationStack {
            Form {
                if let about = edit.note?.recipeTitle ?? edit.recipeTitle {
                    Section { Label(about, systemImage: "book").foregroundStyle(Theme.brandDeep) }
                }
                TextField("Title", text: $title)
                TextField("Write your note…", text: $text, axis: .vertical).lineLimit(6...20)
                if edit.note != nil {
                    Button("Delete note", role: .destructive) { confirmDelete = true }
                }
            }
            .navigationTitle(edit.note == nil ? "New note" : "Edit note")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }.bold()
                        .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .confirmationDialog("Delete this note?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    Task {
                        if let note = edit.note, await WebAction.run("notes.delete", [.string(note.id)]) { await saved(); dismiss() }
                    }
                }
            }
        }
        .onAppear {
            title = edit.note?.title ?? ""
            text = edit.note?.body ?? ""
        }
    }

    private func save() async {
        var fields: [String: JSONValue] = ["title": .string(title), "body": .string(text)]
        if let recipeId = edit.recipeId { fields["recipeId"] = .string(recipeId) }
        let ok = if let note = edit.note {
            await WebAction.run("notes.update", [.string(note.id), .object(fields)], done: "Note saved.")
        } else {
            await WebAction.run("notes.create", [.object(fields)], done: "Note saved.")
        }
        if ok { await saved(); dismiss() }
    }
}
