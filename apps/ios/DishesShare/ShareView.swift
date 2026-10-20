// The share sheet's card: what's being imported, then the recipe's name or
// what went wrong. Styled as the app (Dishes/Design/Theme.swift), which the
// extension can't compile in, so the few colours it needs are copied here.

import SwiftUI
import UIKit

struct ShareView: View {
    let model: ShareModel

    private static let orange = Color(red: 0xF9 / 255, green: 0x73 / 255, blue: 0x16 / 255)
    private static let rose = Color(red: 0xF4 / 255, green: 0x3F / 255, blue: 0x5E / 255)
    private static let brand = LinearGradient(colors: [orange, rose], startPoint: .leading, endPoint: .trailing)

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                header
                content
                Spacer(minLength: 0)
            }
            .padding(20)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(Color(uiColor: .systemBackground))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !isDone {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { model.cancel() }
                    }
                }
            }
        }
    }

    private var isDone: Bool {
        if case .done = model.stage { true } else { false }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "fork.knife")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .background(Self.brand, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text("Import to Dishes").font(.system(size: 22, weight: .bold))
                Text("Ingredients, method, timings and the photo.")
                    .font(.system(size: 14)).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder private var content: some View {
        switch model.stage {
        case .finding:
            ProgressView().frame(maxWidth: .infinity).padding(.vertical, 40)

        case .importing(let page):
            VStack(spacing: 14) {
                ProgressView().controlSize(.large).tint(Self.orange)
                Text("Reading the recipe…").font(.system(size: 17, weight: .semibold))
                Text(page.host() ?? page.absoluteString)
                    .font(.system(size: 13)).foregroundStyle(.secondary)
                Text("Usually a few seconds; up to a minute when the AI tidies it up.")
                    .font(.system(size: 14)).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 36)

        case .done(let title, let notice):
            card {
                Label("Saved to your recipes", systemImage: "checkmark.circle.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.green)
                Text(title.isEmpty ? "The recipe" : title).font(.system(size: 18, weight: .bold))
                Text("It’ll be in Dishes next time you open the app — check it over there.")
                    .font(.system(size: 14)).foregroundStyle(.secondary)
                if let notice {
                    Label(notice, systemImage: "info.circle")
                        .font(.system(size: 13)).foregroundStyle(.orange)
                }
            }
            primary("Done") { model.finish() }

        case .signedOut:
            card {
                Label("Sign in to Dishes first", systemImage: "person.crop.circle.badge.exclamationmark")
                    .font(.system(size: 16, weight: .semibold))
                Text("Open the Dishes app and sign in, then share the page again.")
                    .font(.system(size: 14)).foregroundStyle(.secondary)
            }
            primary("Close") { model.cancel() }

        case .failed(let message):
            card {
                Label("That didn’t work", systemImage: "exclamationmark.triangle")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.red)
                Text(message).font(.system(size: 14)).foregroundStyle(.secondary)
            }
            primary("Try again") { Task { await model.retry() } }
        }
    }

    private func card(@ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 10, content: content)
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(uiColor: .secondarySystemBackground),
                        in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .shadow(color: .black.opacity(0.08), radius: 2, y: 1)
    }

    private func primary(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 46)
                .background(Self.brand, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .shadow(color: .black.opacity(0.12), radius: 5, y: 3)
        }
        .buttonStyle(.plain)
    }
}
