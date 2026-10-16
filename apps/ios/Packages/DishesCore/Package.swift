// swift-tools-version: 6.2
// DishesCore: everything in the iOS app that isn't UI — models, local store,
// sync, API client and auth. `swift test` runs it on macOS without a
// simulator, against the shared fixtures in ../../../../fixtures.
//
// GRDB is the only third-party dependency; everything else is Apple
// frameworks (TODO_MOBILE.md, Phase C).
import PackageDescription

let package = Package(
    name: "DishesCore",
    platforms: [.iOS(.v26), .macOS(.v26)],
    products: [
        .library(name: "DishesCore", targets: ["DishesCore"]),
    ],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "7.0.0"),
    ],
    targets: [
        .target(name: "DishesCore", dependencies: [.product(name: "GRDB", package: "GRDB.swift")]),
        .testTarget(name: "DishesCoreTests", dependencies: ["DishesCore"]),
    ]
)
