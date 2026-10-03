import AVFoundation

/** Run with TimelineStillVideo.swift and TimelineExportFailure.swift on macOS. */
@main
struct HeldFrameChecks {
  @MainActor
  static func main() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    func image(_ color: CGColor) -> CGImage {
      let c = CGContext(data: nil, width: 64, height: 48, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
      c.setFillColor(color)
      c.fill(CGRect(x: 0, y: 0, width: 64, height: 48))
      return c.makeImage()!
    }
    let composition = AVMutableComposition()
    let track = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)!
    let part = CMTime(value: 250, timescale: 1000)
    for (index, color) in [CGColor(red: 1, green: 0, blue: 0, alpha: 1), CGColor(red: 0, green: 0, blue: 1, alpha: 1)].enumerated() {
      let url = directory.appendingPathComponent("\(index).mp4")
      try await TimelineStillVideo.write(image(color), duration: part, to: url, check: {})
      let asset = AVURLAsset(url: url)
      let source = try await asset.loadTracks(withMediaType: .video)[0]
      try track.insertTimeRange(CMTimeRange(start: .zero, duration: part), of: source, at: CMTimeMultiply(part, multiplier: Int32(index)))
    }
    let frame = try await TimelineStillVideo.finalFrame(of: composition, check: {})
    let pixel = CGContext(data: nil, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue)!
    pixel.draw(frame, in: CGRect(x: 0, y: 0, width: 1, height: 1))
    let rgba = pixel.data!.assumingMemoryBound(to: UInt8.self)
    precondition(rgba[2] > 200 && Int(rgba[2]) - Int(rgba[0]) > 150 && Int(rgba[2]) - Int(rgba[1]) > 150, "Did not hold the final blue frame")
    let output = directory.appendingPathComponent("held.mp4")
    try await TimelineStillVideo.write(frame, duration: CMTime(value: 1750, timescale: 1000), to: output, check: {})
    let held = AVURLAsset(url: output)
    let duration = try await held.load(.duration)
    precondition(abs(duration.seconds - 1.75) < 0.002)
    let audio = try await held.loadTracks(withMediaType: .audio)
    precondition(audio.isEmpty)
    do {
      _ = try await TimelineStillVideo.finalFrame(of: composition, check: { throw CancellationError() })
      preconditionFailure("Cancelled frame reads must fail")
    } catch is CancellationError {}
    print("Final-frame checks passed: last-frame color, exact held duration, no audio, cancellation.")
  }
}
