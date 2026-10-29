// The first screen on a new device: what Dishes is and one button. Sign-in is
// the family's Authelia (the same account as the website), in Apple's secure
// browser sheet.
//
//   SignInView()   // shown by RootView while AppModel.phase == .signedOut

import SwiftUI

struct SignInView: View {
    @Environment(AppModel.self) private var app
    @State private var busy = false
    @State private var developer = false

    var body: some View {
        VStack(spacing: 28) {
            Spacer()
            Image("AppIconImage")
                .resizable()
                .frame(width: 96, height: 96)
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                .shadow(color: Theme.brand.opacity(0.4), radius: 16, y: 8)
            VStack(spacing: 8) {
                Text("Dishes")
                    .font(.system(size: 44, weight: .bold, design: .rounded))
                Text("Recipes, meal plans and the shopping list — for the whole household.")
                    .font(.title3)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            Spacer()
            VStack(spacing: 14) {
                if let error = app.signInError {
                    Text(error)
                        .font(.subheadline)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                }
                Button {
                    busy = true
                    Task {
                        await app.signIn()
                        busy = false
                    }
                } label: {
                    Text(busy ? "Signing in…" : "Sign in").frame(maxWidth: .infinity)
                }
                .buttonStyle(.wide(.primary))
                .disabled(busy)
                Text("Use the same account as the Dishes website.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                #if DEBUG
                Button("Developer") { developer = true }
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                #endif
            }
            .frame(maxWidth: 420)
        }
        #if DEBUG
        .sheet(isPresented: $developer) {
            Form { DeveloperSection() }
                .presentationDetents([.medium])
        }
        #endif
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background.ignoresSafeArea())
    }
}
