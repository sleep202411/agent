import AVFoundation
import ExpoModulesCore

public final class FizzTimelineExportModule: Module {
  private var jobID: String?
  private var work: Task<Void, Never>?
  private var session: AVAssetExportSession?
  private var outputs: [String: URL] = [:]

  public func definition() -> ModuleDefinition {
    Name("FizzTimelineExport")
    Events("progress")
    AsyncFunction("render") { (id: String, shots: [[String: Any]], promise: Promise) in
      guard self.jobID == nil else {
        promise.reject("EXPORT_BUSY", "A timeline export is already running.")
        return
      }
      self.jobID = id
      self.work = Task { @MainActor in
        var output: URL?
        do {
          guard UUID(uuidString: id) != nil, !shots.isEmpty else { throw self.failure("Invalid export request.") }
          let composition = AVMutableComposition()
          guard let video = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
                let audio = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
          else { throw self.failure("Cannot create timeline tracks.") }
          var cursor = CMTime.zero
          var ids: [String] = []
          var instructions: [AVMutableVideoCompositionInstruction] = []
          var canvas: CGSize?
          for shot in shots {
            try self.check(id)
            guard let clipID = shot["id"] as? String, !clipID.isEmpty, !ids.contains(clipID),
                  let source = shot["url"] as? String, let url = URL(string: source),
                  url.scheme == "https", url.host != nil, url.user == nil, url.password == nil,
                  let milliseconds = shot["durationMs"] as? NSNumber,
                  milliseconds.doubleValue.isFinite, milliseconds.doubleValue > 0,
                  milliseconds.doubleValue <= 9_007_199_254_740_991,
                  milliseconds.doubleValue.rounded() == milliseconds.doubleValue
            else { throw self.failure("Invalid timeline clip.") }
            let asset = AVURLAsset(url: url)
            let tracks = try await asset.loadTracks(withMediaType: .video)
            guard let sourceVideo = tracks.first else { throw self.failure("A timeline clip has no video track.") }
            let duration = try await asset.load(.duration)
            guard duration.isNumeric, duration.seconds > 0 else { throw self.failure("Invalid source duration.") }
            let length = CMTimeMinimum(duration, CMTime(seconds: milliseconds.doubleValue / 1000, preferredTimescale: 600))
            let sourceRange = CMTimeRange(start: .zero, duration: length)
            let size = try await sourceVideo.load(.naturalSize)
            let transform = try await sourceVideo.load(.preferredTransform)
            let bounds = CGRect(origin: .zero, size: size).applying(transform)
            guard bounds.width.isFinite, bounds.height.isFinite, bounds.width > 0, bounds.height > 0 else { throw self.failure("Invalid video dimensions.") }
            if canvas == nil {
              canvas = CGSize(width: max(2, floor(bounds.width / 2) * 2), height: max(2, floor(bounds.height / 2) * 2))
            }
            try self.check(id)
            try video.insertTimeRange(sourceRange, of: sourceVideo, at: cursor)
            let sourceAudio = try await asset.loadTracks(withMediaType: .audio)
            if let track = sourceAudio.first {
              let available = try await track.load(.timeRange)
              let range = CMTimeRangeGetIntersection(sourceRange, available)
              if range.duration.isNumeric && range.duration.seconds > 0 {
                try audio.insertTimeRange(range, of: track, at: CMTimeAdd(cursor, range.start))
              }
            }
            try self.check(id)
            let target = canvas!
            let scale = min(target.width / bounds.width, target.height / bounds.height)
            let placement = transform
              .concatenating(CGAffineTransform(translationX: -bounds.minX, y: -bounds.minY))
              .concatenating(CGAffineTransform(scaleX: scale, y: scale))
              .concatenating(CGAffineTransform(translationX: (target.width - bounds.width * scale) / 2, y: (target.height - bounds.height * scale) / 2))
            let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: video)
            layer.setTransform(placement, at: cursor)
            let instruction = AVMutableVideoCompositionInstruction()
            instruction.timeRange = CMTimeRange(start: cursor, duration: length)
            instruction.layerInstructions = [layer]
            instructions.append(instruction)
            ids.append(clipID)
            cursor = CMTimeAdd(cursor, length)
          }
          try self.check(id)
          let videoComposition = AVMutableVideoComposition()
          videoComposition.renderSize = canvas!
          videoComposition.frameDuration = CMTime(value: 1, timescale: 30)
          videoComposition.instructions = instructions
          guard let encoder = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else { throw self.failure("Video export is not supported on this device.") }
          let directory = FileManager.default.temporaryDirectory.appendingPathComponent("fizz-timeline-export", isDirectory: true)
          try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
          let destination = directory.appendingPathComponent("\(UUID().uuidString).mp4")
          output = destination
          encoder.outputURL = destination
          encoder.outputFileType = .mp4
          encoder.videoComposition = videoComposition
          encoder.shouldOptimizeForNetworkUse = true
          self.session = encoder
          let progress = Task { @MainActor in
            while !Task.isCancelled && self.jobID == id {
              self.sendEvent("progress", ["id": id, "ratio": Double(encoder.progress)])
              try? await Task.sleep(nanoseconds: 250_000_000)
            }
          }
          await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            encoder.exportAsynchronously { continuation.resume() }
          }
          progress.cancel()
          try self.check(id)
          guard encoder.status == .completed else { throw encoder.error ?? self.failure("Timeline encoding failed.") }
          let bytes = try destination.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
          guard bytes > 0 else { throw self.failure("The encoder returned an empty file.") }
          self.outputs[destination.absoluteString] = destination
          let receipt: [String: Any] = ["artifact": ["uri": destination.absoluteString, "contentType": "video/mp4", "size": bytes] as [String: Any], "completedClipIds": ids]
          promise.resolve(receipt)
        } catch {
          if let output { try? FileManager.default.removeItem(at: output) }
          promise.reject("EXPORT_FAILED", error.localizedDescription)
        }
        if self.jobID == id { self.jobID = nil; self.session = nil; self.work = nil }
      }
    }.runOnQueue(.main)
    AsyncFunction("cancel") { (id: String) in self.cancel(id) }.runOnQueue(.main)
    AsyncFunction("release") { (uri: String) in
      if let url = self.outputs.removeValue(forKey: uri) { try FileManager.default.removeItem(at: url) }
    }.runOnQueue(.main)
    OnDestroy {
      DispatchQueue.main.async {
        if let id = self.jobID { self.cancel(id) }
        for url in self.outputs.values { try? FileManager.default.removeItem(at: url) }
        self.outputs.removeAll()
      }
    }
  }

  private func cancel(_ id: String) {
    guard jobID == id else { return }
    work?.cancel()
    session?.cancelExport()
    // Keep ownership until the async worker has observed cancellation and settled.
  }
  private func check(_ id: String) throws {
    try Task.checkCancellation()
    guard jobID == id else { throw failure("Timeline export session ended.") }
  }
  private func failure(_ message: String) -> NSError {
    NSError(domain: "FizzTimelineExport", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
}
