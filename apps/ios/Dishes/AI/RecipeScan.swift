// Getting a recipe's pages in: VisionKit's document camera (it finds the
// page's edges and flattens it, any number of pages — a two-page recipe in one
// go), and the photos made ready for reading (DishesCore/AI/RecipeReader).
//
//   .fullScreenCover(isPresented: $scanning) { DocumentScanner { pages in … } }

import SwiftUI
import UIKit
import VisionKit

struct DocumentScanner: UIViewControllerRepresentable {
    let onPages: ([UIImage]) -> Void
    @Environment(\.dismiss) private var dismiss

    static var isAvailable: Bool { VNDocumentCameraViewController.isSupported }

    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let camera = VNDocumentCameraViewController()
        camera.delegate = context.coordinator
        return camera
    }

    func updateUIViewController(_ controller: VNDocumentCameraViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    // VisionKit calls its delegate on the main thread, though its protocol doesn't say so.
    @MainActor
    final class Coordinator: NSObject, @preconcurrency VNDocumentCameraViewControllerDelegate {
        let parent: DocumentScanner
        init(_ parent: DocumentScanner) { self.parent = parent }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
            let pages = (0..<scan.pageCount).map { scan.imageOfPage(at: $0) }
            parent.dismiss()
            parent.onPages(pages)
        }

        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) { parent.dismiss() }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
            parent.dismiss()
        }
    }
}

extension UIImage {
    /// Drawn the right way up (a camera photo's pixels may be sideways, with
    /// the orientation only in its metadata) and no bigger than Vision needs.
    func uprightCGImage(maxDimension: CGFloat) -> CGImage? {
        let scale = min(1, maxDimension / max(size.width, size.height))
        let target = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in draw(in: CGRect(origin: .zero, size: target)) }.cgImage
    }

    /// Pages one above the other, for the server, which reads a single image.
    static func stacked(_ pages: [UIImage]) -> UIImage {
        guard pages.count > 1 else { return pages.first ?? UIImage() }
        let width = pages.map(\.size.width).max() ?? 0
        let heights = pages.map { $0.size.height * width / $0.size.width }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: width, height: heights.reduce(0, +)), format: format).image { _ in
            var y: CGFloat = 0
            for (page, height) in zip(pages, heights) {
                page.draw(in: CGRect(x: 0, y: y, width: width, height: height))
                y += height
            }
        }
    }
}
