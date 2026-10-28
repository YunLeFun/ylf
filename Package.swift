// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "YunleApple",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "YunleSupportUI", targets: ["YunleSupportUI"])],
    targets: [
        .target(name: "YunleSupportUI", path: "packages/apple-support/Sources/YunleSupportUI",
                resources: [.process("Resources")]),
        .testTarget(name: "YunleSupportUITests", dependencies: ["YunleSupportUI"],
                    path: "packages/apple-support/Tests/YunleSupportUITests"),
    ]
)
