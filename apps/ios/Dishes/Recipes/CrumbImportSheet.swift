// Import from Crumb, as the web's: choose a Crumb export (.crumb files, or a
// .zip of them, from Files), see the recipes in it, pick which to bring in.

import DishesCore
import SwiftUI
import UniformTypeIdentifiers

struct CrumbImportSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var choosing = true
    @State private var preview: JSONValue?
    @State private var picked: Set<Int> = []
    @State private var working: String?

    private var items: [(index: Int, title: String, detail: String)] {
        (preview?.array("recipes") ?? []).compactMap { item in
            guard let index = item.int("index") else { return nil }
            let detail = ["\(item.int("ingredientCount") ?? 0) ingredients", "\(item.int("stepCount") ?? 0) steps",
                          Format.minutes(item.int("cookTimeMinutes"))].compactMap { $0 }.joined(separator: " · ")
            return (index, item.string("title") ?? "Recipe", detail)
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if let working {
                    ProgressView(working).frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if preview == nil {
                    VStack(spacing: 14) {
                        Image(systemName: "tray.and.arrow.down").font(.system(size: 40)).foregroundStyle(Theme.brand)
                        Text("Choose a Crumb export").font(.system(size: 18, weight: .bold))
                        Text("In Crumb, export your recipes, save the file to Files, then pick it here.")
                            .font(.system(size: 14)).foregroundStyle(Theme.mutedForeground).multilineTextAlignment(.center)
                        Button("Choose file") { choosing = true }.buttonStyle(.brand).frame(maxWidth: 260)
                    }
                    .padding(30).frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        Section {
                            Button(picked.count == items.count ? "Select none" : "Select all") {
                                picked = picked.count == items.count ? [] : Set(items.map(\.index))
                            }
                        }
                        ForEach(items, id: \.index) { item in
                            Button {
                                if picked.contains(item.index) { picked.remove(item.index) } else { picked.insert(item.index) }
                            } label: {
                                HStack {
                                    Image(systemName: picked.contains(item.index) ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(picked.contains(item.index) ? Theme.brand : Theme.mutedForeground)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(item.title).foregroundStyle(Theme.foreground)
                                        Text(item.detail).font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Import from Crumb").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                if preview != nil {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Import \(picked.count)") { Task { await importPicked() } }.bold()
                            .disabled(picked.isEmpty || working != nil)
                    }
                }
            }
            .fileImporter(isPresented: $choosing, allowedContentTypes: [.zip, .data, .json], allowsMultipleSelection: true) { result in
                guard case .success(let urls) = result, !urls.isEmpty else { return }
                Task { await read(urls) }
            }
        }
    }

    private func read(_ urls: [URL]) async {
        working = "Reading your recipes…"
        defer { working = nil }
        var files: [(String, Data)] = []
        for url in urls {
            let ok = url.startAccessingSecurityScopedResource()
            defer { if ok { url.stopAccessingSecurityScopedResource() } }
            if let data = try? Data(contentsOf: url) { files.append((url.lastPathComponent, data)) }
        }
        do {
            preview = try await app.api.crumbPreview(files: files.map { (name: $0.0, data: $0.1) })
            picked = Set(items.map(\.index))
        } catch {
            app.toast = WebAction.explain(error)
        }
    }

    private func importPicked() async {
        working = "Importing \(picked.count) recipes…"
        defer { working = nil }
        do {
            let count = try await app.api.crumbImport(sessionId: preview?.string("sessionId"), indices: picked.sorted(),
                                                      fullData: preview?["fullData"])
            await app.syncNow()
            app.toast = "Imported \(count) recipe\(count == 1 ? "" : "s")."
            dismiss()
        } catch {
            app.toast = WebAction.explain(error)
        }
    }
}
