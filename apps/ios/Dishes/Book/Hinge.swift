// The iPhone Duo's hinge, as a posture the app can act on. UIKit reports the
// hinge's status (closed, partially open, fully open) through a
// UIHingeInteraction (iOS 27.1); which way it's turned comes from the screen's
// shape. The hinge splits the inner screen's longer side, so half open with the
// screen wider than tall is held like a book (two pages, hinge upright), and
// taller than wide is stood on the worktop like a laptop (hinge level).
//
//   HingeObserver()                          // once, behind RootView
//   Hinge.shared.posture(for: size)          // .flat / .book / .stand

import SwiftUI
import UIKit

enum FoldPosture: Equatable {
    /// No hinge (every other iPhone and iPad), or opened flat, or closed.
    case flat
    /// Half open with the hinge upright: book mode.
    case book
    /// Half open with the hinge level: stand mode (cooking, later).
    case stand
}

@MainActor @Observable
final class Hinge {
    static let shared = Hinge()

    private(set) var partiallyOpen = false

    fileprivate func update(partiallyOpen: Bool) {
        if self.partiallyOpen != partiallyOpen { self.partiallyOpen = partiallyOpen }
    }

    func posture(for size: CGSize) -> FoldPosture {
        guard partiallyOpen else { return .flat }
        return size.width > size.height ? .book : .stand
    }
}

/// A hidden view carrying the hinge interaction. Does nothing before iOS 27.1
/// or on a device without a hinge.
struct HingeObserver: UIViewRepresentable {
    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.isUserInteractionEnabled = false
        if #available(iOS 27.1, *) {
            view.addInteraction(UIHingeInteraction { _, update in
                let open = update.hinge?.status == .partiallyOpen
                MainActor.assumeIsolated { Hinge.shared.update(partiallyOpen: open) }
            })
        }
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {}
}
