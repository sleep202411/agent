import Foundation
import AVFoundation

enum TimelineExportFailure {
  // Only source-specific errors may enter clip isolation. Device reset, encoder,
  // disk, authorization, cancellation and unknown errors remain fatal.
  static func isSourceFailure(_ error: Error, depth: Int = 0) -> Bool {
    guard depth < 8 else { return false }
    let value = error as NSError
    if value.domain == "FizzTimelineSource" { return true }
    if value.domain == NSURLErrorDomain {
      return [NSURLErrorTimedOut, NSURLErrorCannotFindHost, NSURLErrorCannotConnectToHost,
              NSURLErrorNetworkConnectionLost, NSURLErrorNotConnectedToInternet,
              NSURLErrorBadServerResponse, NSURLErrorResourceUnavailable].contains(value.code)
    }
    guard value.domain == AVFoundationErrorDomain else { return false }
    switch value.code {
    case AVError.Code.decodeFailed.rawValue,
         AVError.Code.fileFormatNotRecognized.rawValue,
         AVError.Code.fileFailedToParse.rawValue,
         AVError.Code.failedToLoadMediaData.rawValue,
         AVError.Code.failedToLoadSampleData.rawValue:
      return true
    case AVError.Code.exportFailed.rawValue:
      if let underlying = value.userInfo[NSUnderlyingErrorKey] as? NSError {
        return isSourceFailure(underlying, depth: depth + 1)
      }
      return false
    default:
      return false
    }
  }
  static func sourceFailure(_ message: String) -> NSError {
    NSError(domain: "FizzTimelineSource", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }

}
