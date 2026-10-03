import AVFoundation

/** macOS AVFoundation harness for the shared iOS still writer; not an iOS app/device test. */
@main
struct StillVideoChecks {
  @MainActor
  static func main() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let context = CGContext(data: nil, width: 64, height: 48, bitsPerComponent: 8, bytesPerRow: 0,
      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.setFillColor(CGColor(red: 1, green: 0, blue: 0, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: 64, height: 48))
    let image = context.makeImage()!
    for milliseconds: Int64 in [1, 3250] {
      let url = directory.appendingPathComponent("still-\(milliseconds).mp4")
      try await TimelineStillVideo.write(image, duration: CMTime(value: milliseconds, timescale: 1000),
        to: url, check: {})
      let asset = AVURLAsset(url: url)
      let duration = try await asset.load(.duration)
      precondition(abs(duration.seconds - Double(milliseconds) / 1000) < 0.002, "Incorrect still duration: \(duration.seconds)")
      let tracks = try await asset.loadTracks(withMediaType: .video)
      precondition(tracks.count == 1)
      let size = try await tracks[0].load(.naturalSize)
      precondition(size == CGSize(width: 64, height: 48))
      let generator = AVAssetImageGenerator(asset: asset)
      let decoded = try generator.copyCGImage(at: .zero, actualTime: nil)
      let pixel = CGContext(data: nil, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue)!
      pixel.draw(decoded, in: CGRect(x: 0, y: 0, width: 1, height: 1))
      let rgba = pixel.data!.assumingMemoryBound(to: UInt8.self)
      precondition(rgba[0] > 200 && rgba[1] < 40 && rgba[2] < 40, "Still image pixels were not preserved")
      let audio = try await asset.loadTracks(withMediaType: .audio)
      precondition(audio.isEmpty)
    }
    var checks = 0
    do {
      try await TimelineStillVideo.write(image, duration: CMTime(seconds: 100, preferredTimescale: 1000),
        to: directory.appendingPathComponent("cancelled.mp4"), check: {
          checks += 1
          if checks > 10 { throw CancellationError() }
        })
      preconditionFailure("Cancellation must propagate")
    } catch is CancellationError {}
    print("Still writer: short/fractional durations, dimensions, silent output and cancellation passed.")
  }
}
