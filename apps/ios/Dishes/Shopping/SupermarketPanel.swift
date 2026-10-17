// Sainsbury's beside the list: the web's per-item cart link
// (shopping-item.tsx, gol-ui/SearchResults/<item>) opened in a web view. On a
// wide screen it's a side panel, so you can tick an item, search the next one
// and add it to the trolley without leaving the list; on iPhone it's a sheet.
//
// The web view uses the default website data store, so a Sainsbury's sign-in
// made here is remembered between searches and launches.

import SwiftUI
import WebKit

enum Supermarket {
    static func searchURL(for item: String) -> URL? {
        let query = item.trimmingCharacters(in: .whitespaces)
            .addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? ""
        return URL(string: "https://www.sainsburys.co.uk/gol-ui/SearchResults/\(query)")
    }
}

/// A URL that can drive `.sheet(item:)`.
struct WebDestination: Identifiable, Hashable {
    let url: URL
    var id: String { url.absoluteString }
}

struct SupermarketPanel: View {
    let url: URL
    var close: () -> Void
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "cart.fill")
                    .foregroundStyle(.white)
                    .frame(width: 28, height: 28)
                    .background(Color(hex: 0xF06C00), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                Text("Sainsbury’s").font(.system(size: 16, weight: .semibold))
                Spacer()
                Button { openURL(url) } label: {
                    Image(systemName: "safari").font(.system(size: 16))
                }
                .accessibilityLabel("Open in Safari")
                Button(action: close) {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .bold))
                        .frame(width: 30, height: 30)
                        .background(Theme.muted, in: Circle())
                }
                .accessibilityLabel("Close Sainsbury’s")
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.foreground)
            .padding(.horizontal, 14)
            .frame(height: 54)
            .overlay(alignment: .bottom) { Rectangle().fill(Theme.border).frame(height: 1) }

            SupermarketWebView(url: url)
        }
        .background(Theme.background)
    }
}

/// WKWebView, reloading only when the URL actually changes so the shopper's
/// own navigation inside the page isn't thrown away on every SwiftUI update.
struct SupermarketWebView: UIViewRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let view = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        view.allowsBackForwardNavigationGestures = true
        context.coordinator.loaded = url
        view.load(URLRequest(url: url))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        guard context.coordinator.loaded != url else { return }
        context.coordinator.loaded = url
        view.load(URLRequest(url: url))
    }

    final class Coordinator { var loaded: URL? }
}
