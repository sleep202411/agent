import Foundation
import AVFoundation

func av(_ code: AVError.Code, _ underlying: NSError? = nil) -> NSError {
  NSError(domain: AVFoundationErrorDomain, code: code.rawValue, userInfo: underlying.map { [NSUnderlyingErrorKey: $0] } ?? [:])
}
@main
struct ErrorClassificationChecks {
  static func main() {
    assert(TimelineExportFailure.isSourceFailure(av(.decodeFailed)))
    assert(TimelineExportFailure.isSourceFailure(av(.fileFailedToParse)))
    assert(TimelineExportFailure.isSourceFailure(av(.exportFailed, av(.decodeFailed))))
    // The reset enum is iOS-only; use its AVFoundation error code for this macOS-host check.
    assert(!TimelineExportFailure.isSourceFailure(NSError(domain: AVFoundationErrorDomain, code: -11819)))
    assert(!TimelineExportFailure.isSourceFailure(av(.applicationIsNotAuthorized)))
    assert(!TimelineExportFailure.isSourceFailure(av(.encoderNotFound)))
    assert(!TimelineExportFailure.isSourceFailure(av(.exportFailed)))
    assert(!TimelineExportFailure.isSourceFailure(NSError(domain: NSURLErrorDomain, code: NSURLErrorCancelled)))
    assert(TimelineExportFailure.isSourceFailure(NSError(domain: NSURLErrorDomain, code: NSURLErrorTimedOut)))
    assert(!TimelineExportFailure.isSourceFailure(NSError(domain: NSCocoaErrorDomain, code: NSFileWriteOutOfSpaceError)))
    print("10 native error classification checks passed")

  }
}
