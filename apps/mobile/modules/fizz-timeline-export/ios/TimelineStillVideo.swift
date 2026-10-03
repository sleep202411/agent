import AVFoundation
import ImageIO
import CoreImage

/** Encode a still using bounded frame storage; the caller owns the temporary output. */
@MainActor
enum TimelineStillVideo {
  static func image(from url: URL, check: () throws -> Void) async throws -> CGImage {
    let (download, response) = try await URLSession.shared.download(from: url)
    defer { try? FileManager.default.removeItem(at: download) }
    try check()
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      throw TimelineExportFailure.sourceFailure("Cannot load timeline image.")
    }
    guard let source = CGImageSourceCreateWithURL(download as CFURL, nil),
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let width = properties[kCGImagePropertyPixelWidth] as? NSNumber,
          let height = properties[kCGImagePropertyPixelHeight] as? NSNumber,
          width.intValue > 0, height.intValue > 0,
          let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: max(width.intValue, height.intValue)
          ] as CFDictionary) else {
      throw TimelineExportFailure.sourceFailure("Cannot decode timeline image.")
    }
    try check()
    return image
  }

  /** Decode to the actual final sample rather than selecting an approximate keyframe. */
  static func finalFrame(of asset: AVAsset, check: () throws -> Void) async throws -> CGImage {
    try check()
    guard let track = try await asset.loadTracks(withMediaType: .video).first else {
      throw TimelineExportFailure.sourceFailure("A timeline clip has no video track.")
    }
    let transform = try await track.load(.preferredTransform)
    let reader = try AVAssetReader(asset: asset)
    defer { if reader.status == .reading { reader.cancelReading() } }
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
    ])
    output.alwaysCopiesSampleData = false
    guard reader.canAdd(output) else { throw failure("Cannot read the final video frame.") }
    reader.add(output)
    guard reader.startReading() else { throw reader.error ?? failure("Cannot start video decoding.") }
    var last: CVPixelBuffer?
    var frames = 0
    while let sample = output.copyNextSampleBuffer() {
      try check()
      if let buffer = CMSampleBufferGetImageBuffer(sample) { last = buffer }
      frames += 1
      if frames % 30 == 0 { await Task.yield() }
    }
    try check()
    guard reader.status == .completed else { throw reader.error ?? failure("Video decoding stopped.") }
    guard let last else { throw TimelineExportFailure.sourceFailure("A timeline clip has no decodable frames.") }
    let frame = CIImage(cvPixelBuffer: last).transformed(by: transform)
    guard let image = CIContext().createCGImage(frame, from: frame.extent) else {
      throw failure("Cannot preserve the final video frame.")
    }
    return image
  }

  static func write(_ image: CGImage, duration: CMTime, to output: URL,
                    check: () throws -> Void) async throws {
    try check()
    guard duration.isNumeric, duration.seconds > 0 else { throw failure("Invalid still duration.") }
    let width = max(2, image.width / 2 * 2)
    let height = max(2, image.height / 2 * 2)
    let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
    defer { if writer.status == .writing { writer.cancelWriting() } }
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: width,
      AVVideoHeightKey: height
    ])
    input.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input,
      sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: width,
        kCVPixelBufferHeightKey as String: height,
        kCVPixelBufferCGImageCompatibilityKey as String: true,
        kCVPixelBufferCGBitmapContextCompatibilityKey as String: true
      ])
    guard writer.canAdd(input) else { throw failure("Still-image encoding is not supported.") }
    writer.add(input)
    guard writer.startWriting() else { throw writer.error ?? failure("Cannot start still-image encoding.") }
    writer.startSession(atSourceTime: .zero)
    guard let pool = adaptor.pixelBufferPool else { throw failure("Cannot allocate image frame pool.") }
    var allocated: CVPixelBuffer?
    guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &allocated) == kCVReturnSuccess,
          let buffer = allocated else { throw failure("Cannot allocate image frame.") }
    CVPixelBufferLockBaseAddress(buffer, [])
    do {
      defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
      guard let context = CGContext(data: CVPixelBufferGetBaseAddress(buffer), width: width,
        height: height, bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue)
      else { throw failure("Cannot draw image frame.") }
      context.setFillColor(CGColor(gray: 0, alpha: 1))
      context.fill(CGRect(x: 0, y: 0, width: width, height: height))
      let scale = min(Double(width) / Double(image.width), Double(height) / Double(image.height))
      let drawnWidth = Double(image.width) * scale, drawnHeight = Double(image.height) * scale
      context.draw(image, in: CGRect(x: (Double(width) - drawnWidth) / 2,
        y: (Double(height) - drawnHeight) / 2, width: drawnWidth, height: drawnHeight))
    }
    var frame: Int64 = 0
    while CMTimeCompare(CMTime(value: frame, timescale: 30), duration) < 0 {
      try check()
      while !input.isReadyForMoreMediaData {
        try check()
        guard writer.status == .writing else { throw writer.error ?? failure("Still-image encoding stopped.") }
        try await Task.sleep(nanoseconds: 5_000_000)
      }
      guard adaptor.append(buffer, withPresentationTime: CMTime(value: frame, timescale: 30)) else {
        throw writer.error ?? failure("Cannot encode image frame.")
      }
      frame += 1
      // Let cancellation and other UI work run even when the encoder never applies backpressure.
      if frame % 30 == 0 { await Task.yield() }
    }
    try check()
    writer.endSession(atSourceTime: duration)
    input.markAsFinished()
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      writer.finishWriting { continuation.resume() }
    }
    try check()
    guard writer.status == .completed else { throw writer.error ?? failure("Still-image encoding failed.") }
  }

  private static func failure(_ message: String) -> NSError {
    NSError(domain: "FizzTimelineExport", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
}
