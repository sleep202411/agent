import { WebView } from "react-native-webview";
import {
  allowEnrollmentNavigation,
  isEnrollmentCallback,
  type EnrollmentFrameProps,
} from "./enrollment-frame-policy";
/** Isolated provider session: no app cookie/header injection or message bridge. */
export function EnrollmentFrame({
  uri,
  characterId,
  callbackOrigin,
  title,
  onComplete,
  onError,
}: EnrollmentFrameProps) {
  return (
    <WebView
      accessibilityLabel={title}
      source={{ uri }}
      style={{ height: 560, flex: 0 }}
      incognito
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      originWhitelist={["*"]}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      mixedContentMode="never"
      javaScriptCanOpenWindowsAutomatically={false}
      mediaCapturePermissionGrantType="prompt"
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction
      onShouldStartLoadWithRequest={({ url }) => {
        if (isEnrollmentCallback(url, characterId, callbackOrigin)) {
          onComplete();
          return false;
        }
        if (allowEnrollmentNavigation(url, uri)) return true;
        onError();
        return false;
      }}
      onOpenWindow={onError}
      onError={onError}
      onHttpError={onError}
      onContentProcessDidTerminate={onError}
      onRenderProcessGone={onError}
    />
  );
}
