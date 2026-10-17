// Opens Authelia's sign-in page in ASWebAuthenticationSession and returns the
// `dishes://…` redirect it ends on (iOS only). Not ephemeral, so a sign-in
// already made in Safari can be reused.
//
//   try await auth.signIn { url in
//       try await WebAuthenticator.present(url, callbackScheme: "dishes")
//   }

#if os(iOS)
import AuthenticationServices
import UIKit

@MainActor
public final class WebAuthenticator: NSObject, ASWebAuthenticationPresentationContextProviding {
    public static func present(_ url: URL, callbackScheme: String) async throws -> URL {
        let provider = WebAuthenticator()
        return try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: url, callback: .customScheme(callbackScheme)) { callback, error in
                _ = provider // the session holds its provider weakly: keep it alive until the end
                if let callback { continuation.resume(returning: callback) }
                else { continuation.resume(throwing: error ?? OIDCError.noCode) }
            }
            session.presentationContextProvider = provider
            session.prefersEphemeralWebBrowserSession = false
            session.start()
        }
    }

    public nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            // The scene on screen, else any: a window always comes from a scene, never a bare
            // ASPresentationAnchor() (deprecated, and sized for a screen the app may not fill).
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
                .sorted { ($0.activationState == .foregroundActive ? 0 : 1) < ($1.activationState == .foregroundActive ? 0 : 1) }
            if let window = scenes.lazy.compactMap({ $0.keyWindow ?? $0.windows.first }).first { return window }
            guard let scene = scenes.first else { preconditionFailure("Signing in needs a window on screen") }
            return ASPresentationAnchor(windowScene: scene)
        }
    }
}
#endif
