"use client";

/**
 * /kyc — real-name verification entry. Migrated from
 * fizzdragon-web's `pages/verifyIntl/verifyIntl.vue`.
 *
 * Flow:
 *   1. Load Aliyun Cloudauth SDK (adds window.getMetaInfo).
 *   2. User enters 姓名 + 身份证号 + submits.
 *   3. POST /user/certify/init/web → receive certifyUrl.
 *   4. Redirect the whole page to certifyUrl (Aliyun hosts the actual
 *      liveness / OCR flow on their domain).
 *   5. Aliyun redirects back to /kyc?response=<JSON> when the user finishes.
 *   6. Parse the response, then POST /user/certify/query to confirm
 *      backend status, invalidate user-info + auth-status caches.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Script from "next/script";
import { IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { useCertifyInit, useCertifyQuery } from "@/src/hooks/use-kyc";
import { useUserInfo } from "@/src/hooks/use-user";

const ALIYUN_SDK_URL = "https://o.alicdn.com/yd-cloudauth/cloudauth-cdn/jsvm_all.js";

/** Aliyun SDK injects this on `window` after the script loads. */
declare global {
  interface Window {
    getMetaInfo?: () => unknown;
  }
}

/** Simple 15/18-digit mainland ID card check — enough to block typos before we hit the backend. */
const ID_CARD_REGEX =
  /(^[1-9]\d{5}(18|19|20)\d{2}((0[1-9])|(1[0-2]))(([0-2][1-9])|10|20|30|31)\d{3}[0-9Xx]$)|(^[1-9]\d{5}\d{2}((0[1-9])|(1[0-2]))(([0-2][1-9])|10|20|30|31)\d{3}$)/;

export default function KycPage() {
  const { data: user } = useUserInfo();
  return <KycForm key={user?.id ?? "guest"} />;
}
function KycForm() {
  const t = useTranslations("kyc");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();

  const { data: userInfo } = useUserInfo();
  const { mutateAsync: doInit, isPending: initPending } = useCertifyInit();
  const { mutateAsync: doQuery } = useCertifyQuery();

  const [realName, setRealName] = useState("");
  const [idCard, setIdCard] = useState("");
  const [verifyFailed, setVerifyFailed] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const owner = useRef<object | null>(null);
  const initClaim = useRef<object | null>(null);
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const responseHandledRef = useRef<{ response: string; owner: object } | null>(null);
  useLayoutEffect(() => {
    owner.current = {};
    return () => {
      owner.current = null;
      initClaim.current = null;
      if (redirectTimer.current != null) clearTimeout(redirectTimer.current);
    };
  }, []);

  // Handle the `?response=...` payload Aliyun appends on redirect back.
  // Guarded with a ref so re-renders don't re-parse.
  useEffect(() => {
    const response = searchParams?.get("response");
    const scope = owner.current;
    if (!response || !scope || !userInfo?.id) return;
    if (
      responseHandledRef.current?.response === response &&
      responseHandledRef.current.owner === scope
    )
      return;
    responseHandledRef.current = { response, owner: scope };

    const currentResponse = () =>
      owner.current === scope &&
      responseHandledRef.current?.owner === scope &&
      responseHandledRef.current.response === response;
    void (async () => {
      let consumed = false;
      let failure = t("certificationResultParseFailed");
      try {
        const parsed = JSON.parse(
          response.startsWith("{") ? response : decodeURIComponent(response)
        ) as {
          code?: string;
          reason?: string;
          extInfo?: { certifyId?: string };
        };
        const code = parsed.code;
        const certifyId = parsed.extInfo?.certifyId;
        consumed = code !== "1000";

        if (code === "1000") {
          if (typeof certifyId !== "string" || !certifyId.trim())
            throw new Error("Missing verification identifier");
          failure = t("certificationNotPassed");
          const result = await doQuery(certifyId);
          if (!currentResponse()) return;
          consumed = true;
          if (result.status !== "T") {
            toast.error(t("certificationNotPassed"));
            setVerifyFailed(true);
            return;
          }
          toast.success(t("certificationSuccess"));
          redirectTimer.current = setTimeout(() => {
            if (currentResponse()) router.replace(`/${locale}/profile`);
          }, 1200);
        } else if (code === "1003") {
          toast.error(t("certificationCancelled"));
          setVerifyFailed(true);
        } else if (code === "2006") {
          toast.error(t("certificationNotPassed"));
          setVerifyFailed(true);
        } else {
          toast.error(parsed.reason || t("certificationFailedWithCode", { code: code ?? "?" }));
          setVerifyFailed(true);
        }
      } catch {
        if (!currentResponse()) return;
        toast.error(failure);
        setVerifyFailed(true);
      } finally {
        // Strip the ?response= so a page refresh doesn't re-trigger parsing.
        if (consumed && currentResponse() && typeof window !== "undefined") {
          const url = new URL(window.location.href);
          url.searchParams.delete("response");
          window.history.replaceState(null, "", url.toString());
        }
      }
    })();
  }, [searchParams, doQuery, router, t, userInfo?.id, locale]);

  const handleVerify = async () => {
    const scope = owner.current;
    if (!scope || initClaim.current) return;
    if (!realName.trim()) {
      toast.warning(t("pleaseEnterRealName"));
      return;
    }
    if (!ID_CARD_REGEX.test(idCard.trim())) {
      toast.warning(t("pleaseEnterValidIdCard"));
      return;
    }
    if (!sdkReady || typeof window === "undefined" || !window.getMetaInfo) {
      toast.error(t("certificationComponentLoadFailed"));
      return;
    }
    if (!userInfo?.id) {
      toast.error(t("userIdMissing"));
      return;
    }

    const claim = {};
    initClaim.current = claim;
    try {
      const metaInfo = JSON.stringify(window.getMetaInfo());
      const returnUrl = `${window.location.origin}/${locale}/kyc`;

      const result = await doInit({
        userName: realName.trim(),
        certNo: idCard.trim(),
        userId: userInfo.id,
        metaInfo,
        returnUrl,
      });

      if (owner.current !== scope || initClaim.current !== claim) return;
      if (!result?.certifyUrl) {
        throw new Error("missing certifyUrl");
      }
      // Full-page redirect to Aliyun — they host the liveness / face flow
      // and will bounce back to returnUrl with ?response=... on completion.
      window.location.href = result.certifyUrl;
    } catch (err) {
      if (owner.current !== scope || initClaim.current !== claim) return;
      setVerifyFailed(true);
      const message = err instanceof Error ? err.message : t("getCertifyUrlFailed");
      toast.error(message);
    } finally {
      if (initClaim.current === claim) initClaim.current = null;
    }
  };

  const submitLabel = initPending
    ? t("verifying")
    : verifyFailed
      ? t("reVerify")
      : t("startVerification");

  return (
    <>
      <Script
        src={ALIYUN_SDK_URL}
        strategy="afterInteractive"
        onLoad={() => setSdkReady(true)}
        onError={() => toast.error(t("certificationComponentLoadFailed"))}
      />
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-xl">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-semibold text-foreground">{t("identityVerification")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t("pleaseFillRealInfo")}</p>
          </div>

          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="kyc-realname">{t("realNameLabel")}</FieldLabel>
              <Input
                id="kyc-realname"
                value={realName}
                onChange={(e) => setRealName(e.target.value)}
                placeholder={t("pleaseEnterRealName")}
                autoComplete="off"
                disabled={initPending}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="kyc-idcard">{t("idCardLabel")}</FieldLabel>
              <Input
                id="kyc-idcard"
                value={idCard}
                onChange={(e) => setIdCard(e.target.value)}
                placeholder={t("pleaseEnterIdCard")}
                autoComplete="off"
                disabled={initPending}
              />
            </Field>

            <Button
              size="lg"
              className="mt-2 w-full"
              onClick={handleVerify}
              disabled={initPending || !sdkReady}
            >
              {initPending ? <IconLoader2 className="size-4 animate-spin" /> : null}
              {submitLabel}
            </Button>

            {!sdkReady && (
              <p className="text-center text-xs text-muted-foreground">{t("loadingSdk")}</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
