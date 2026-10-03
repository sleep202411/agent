import { useEffect, useEffectEvent } from "react";
import { View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { parseKycMetadata } from "./kyc-provider-policy";

const sdkUrl = "https://o.alicdn.com/yd-cloudauth/cloudauth-cdn/jsvm_all.js";
type SdkWindow = Window & { getMetaInfo?: () => unknown };
export function KycMetadata({
  onReady,
  onError,
}: {
  onReady: (value: string) => void;
  onError: () => void;
}) {
  const ready = useEffectEvent(onReady),
    failed = useEffectEvent(onError);
  useEffect(() => {
    let settled = false;
    const sdk = window as SdkWindow;
    const script = document.createElement("script");
    const fail = () => {
      if (!settled) {
        settled = true;
        failed();
      }
    };
    const collect = () => {
      if (settled) return;
      try {
        if (!sdk.getMetaInfo) throw Error("SDK unavailable");
        const info = sdk.getMetaInfo();
        const value = parseKycMetadata(
          JSON.stringify({
            type: "meta",
            metaInfo: typeof info === "string" ? info : JSON.stringify(info),
          })
        );
        settled = true;
        ready(value);
      } catch {
        fail();
      }
    };
    const timer = window.setTimeout(fail, 15000);
    script.src = sdkUrl;
    script.async = true;
    script.onload = collect;
    script.onerror = fail;
    if (sdk.getMetaInfo) collect();
    else document.head.appendChild(script);
    return () => {
      settled = true;
      window.clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      script.remove();
    };
  }, []);
  return null;
}
/** The hosted return belongs to Web, so browser previews confirm via the saved attempt ID. */
export function KycProvider({
  uri,
  title,
  onError,
}: {
  uri: string;
  returnUrl: string;
  title: string;
  onReturn: (url: string) => void;
  onError: () => void;
}) {
  const t = useTranslations(),
    theme = useTheme();
  let safe = false;
  try {
    const url = new URL(uri);
    safe = url.protocol === "https:" && !url.username && !url.password;
  } catch {
    /* Render a retryable error on activation. */
  }
  return (
    <View style={{ gap: 12 }}>
      <ThemedText type="small">{t("kyc.webReturnHint")}</ThemedText>
      <a
        href={safe ? uri : undefined}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={title}
        onClick={(e) => {
          if (!safe) {
            e.preventDefault();
            onError();
          }
        }}
        style={{
          padding: 12,
          borderRadius: 8,
          color: theme.text,
          backgroundColor: theme.backgroundElement,
          textDecoration: "none",
          fontSize: 14,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {t("kyc.openProvider")}
      </a>
    </View>
  );
}
