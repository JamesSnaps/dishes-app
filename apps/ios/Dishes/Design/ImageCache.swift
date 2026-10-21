// Recipe photos, loaded ahead of the scroll (TODO_MOBILE.md, D6). iOS 27 has
// no prefetching for SwiftUI's lazy stacks, so the rows ask for the next few
// photos as each card appears (`prefetch`) and RecipeImage draws from here:
// decoded images in memory, the downloads in a URL cache big enough to keep a
// library's thumbnails (the shared one holds 10 MB). Photos are stored under
// unique names, so a cached copy is used without asking the server again.
//
//   ImageCache.shared.prefetch(recipes[(i + 1)...].prefix(6).compactMap(thumbnailURL))

import SwiftUI
import UIKit
import os

/// Unchecked: NSCache is thread-safe, the rest is immutable or behind a lock.
final class ImageCache: @unchecked Sendable {
    static let shared = ImageCache()

    private let memory = NSCache<NSURL, UIImage>()
    private let session: URLSession
    private let inFlight = OSAllocatedUnfairLock<[URL: Task<UIImage?, Never>]>(initialState: [:])

    private init() {
        memory.countLimit = 300
        let config = URLSessionConfiguration.default
        config.urlCache = URLCache(memoryCapacity: 30 << 20, diskCapacity: 300 << 20,
                                   directory: FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
                                       .appending(path: "recipe-photos"))
        config.requestCachePolicy = .returnCacheDataElseLoad
        config.httpMaximumConnectionsPerHost = 4
        session = URLSession(configuration: config)
    }

    /// Already decoded, for drawing without a placeholder flash.
    func cached(_ url: URL) -> UIImage? { memory.object(forKey: url as NSURL) }

    /// The photo, from memory, the disk cache or the network; one download per URL at a time.
    func image(_ url: URL) async -> UIImage? {
        if let hit = cached(url) { return hit }
        let task = inFlight.withLock { running -> Task<UIImage?, Never> in
            if let task = running[url] { return task }
            let task = Task<UIImage?, Never> { [session, memory] in
                guard let (data, _) = try? await session.data(from: url),
                      let image = await UIImage(data: data)?.byPreparingForDisplay() else { return nil }
                memory.setObject(image, forKey: url as NSURL)
                return image
            }
            running[url] = task
            return task
        }
        let image = await task.value
        _ = inFlight.withLock { $0.removeValue(forKey: url) }
        return image
    }

    /// Starts loading photos about to scroll into view.
    func prefetch(_ urls: [URL]) {
        for url in urls where cached(url) == nil {
            Task(priority: .utility) { _ = await image(url) }
        }
    }
}

/// A photo from ImageCache, filling its frame, with `placeholder` until it's there.
struct CachedImage<Placeholder: View>: View {
    let url: URL
    @ViewBuilder let placeholder: Placeholder
    @State private var loaded: UIImage?

    var body: some View {
        Group {
            if let image = loaded ?? ImageCache.shared.cached(url) {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                placeholder
            }
        }
        .task(id: url) { loaded = await ImageCache.shared.image(url) }
    }
}
