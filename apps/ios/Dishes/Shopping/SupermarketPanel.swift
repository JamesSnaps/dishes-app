// Sainsbury's beside the list: the web's per-item cart link
// (shopping-item.tsx, gol-ui/SearchResults/<item>) opened in a web view. On a
// wide screen it's a side panel, so you can tick an item, search the next one
// and add it to the trolley without leaving the list; on iPhone it's a sheet.
//
// The web view uses the default website data store, so a Sainsbury's sign-in
// made here is remembered between searches and launches.
//
// Or, chosen per device in Settings → Shopping, the cart button skips the web
// view and opens the Sainsbury's app (Safari when it isn't installed), which
// keeps its own session and doesn't reload the site on every search.

import SwiftUI
import WebKit

enum Supermarket {
    static func searchURL(for item: String) -> URL? {
        let query = item.trimmingCharacters(in: .whitespaces)
            .addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? ""
        return URL(string: "https://www.sainsburys.co.uk/gol-ui/SearchResults/\(query)")
    }

    /// Where the cart button on an item goes.
    enum Opening: String, CaseIterable {
        case app, inDishes

        var title: String {
            switch self {
            case .app: "Sainsbury’s app"
            case .inDishes: "In Dishes"
            }
        }
    }

    static let openingKey = "supermarket.opening"
    /// The iPad keeps the side panel beside the list; the iPhone goes to the app.
    static var defaultOpening: Opening { UIDevice.current.userInterfaceIdiom == .pad ? .inDishes : .app }
    static var opening: Opening {
        UserDefaults.standard.string(forKey: openingKey).flatMap(Opening.init(rawValue:)) ?? defaultOpening
    }

    /// The Sainsbury's app through its universal link, or Safari when it isn't installed.
    @MainActor static func openOutside(_ url: URL) {
        UIApplication.shared.open(url, options: [.universalLinksOnly: true]) { opened in
            if !opened { UIApplication.shared.open(url) }
        }
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
                    .foregroundStyle(Theme.brandForeground)
                    .frame(width: 28, height: 28)
                    .background(Theme.brand, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
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
