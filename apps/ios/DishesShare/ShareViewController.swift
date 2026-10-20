// The share extension's entry point (NSExtensionPrincipalClass in Info.plist):
// hosts ShareView and starts the import as soon as the sheet opens.

import SwiftUI
import UIKit

@objc(ShareViewController)
final class ShareViewController: UIViewController {
    private var model: ShareModel?

    override func viewDidLoad() {
        super.viewDidLoad()
        let model = ShareModel(context: extensionContext)
        self.model = model

        let host = UIHostingController(rootView: ShareView(model: model))
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)

        Task { await model.start() }
    }
}
