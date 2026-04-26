"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "@/src/i18n/i18n";
import {
  IconCheck,
  IconCircleCheckFilled,
  IconCrown,
  IconDiamond,
  IconLoader2,
  IconX,
} from "@tabler/icons-react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import LightRays from "@/components/ui/light-rays";
import { backendApi } from "@/src/lib/api";
import { cn } from "@/lib/utils";
import { siteConfig } from "@/src/config/site";

// ── Types ───────────────────────────────────────────────────

interface VipPackage {
  id: number;
  packageName: string;
  price: number;
  durationDays: number;
  description?: string;
  rights?: string;
  integralDiscountRate?: number;
  status: string | number;
  sortOrder: number;
}

interface ParsedRights {
  score?: number;
  integralDiscount?: number;
}

function parseRights(rights?: string): ParsedRights {
  if (!rights) return {};
  try {
    const obj = JSON.parse(rights) as Record<string, unknown>;
    const score = typeof obj.score === "number" ? obj.score : undefined;
    const integralDiscount =
      typeof obj.integral_discount === "number" ? obj.integral_discount : undefined;
    return { score, integralDiscount };
  } catch {
    return {};
  }
}

interface RechargeResult {
  orderNo: string;
  url: string;
}
interface OrderStatus {
  status: number;
}

type Step = "select" | "payment" | "success";

export interface UpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

// ── Component ───────────────────────────────────────────────

export function UpgradeDialog({ open, onOpenChange, onSuccess }: UpgradeDialogProps) {
  const t = useTranslations("payment");

  const [packages, setPackages] = useState<VipPackage[]>([]);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<Step>("select");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [currency, setCurrency] = useState(siteConfig.defaultCurrency);
  const [qrUrl, setQrUrl] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const [paying, setPaying] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedPackage = useMemo(
    () => packages.find((p) => p.id === selectedId) ?? null,
    [selectedId, packages]
  );

  type BenefitGroup = { title?: string; items: string[] };

  const planNames: Record<string, string> = {
    VIP1: t("plans.basic"),
    VIP2: t("plans.standard"),
    VIP3: t("plans.pro"),
  };

  const planExtras: Record<
    string,
    {
      addCourse: boolean;
      output: { images: number; videos: number; tmin: number; tmax: number; agents: number };
      storyos: string[];
    }
  > = {
    VIP1: {
      addCourse: false,
      output: { images: 100, videos: 30, tmin: 6, tmax: 7, agents: 180 },
      storyos: [
        t("benefits.storyosCore"),
        t("benefits.storyosMessages", { count: 100 }),
        t("benefits.storyosRetention", { days: 15 }),
      ],
    },
    VIP2: {
      addCourse: true,
      output: { images: 200, videos: 60, tmin: 12, tmax: 14, agents: 360 },
      storyos: [
        t("benefits.storyosFull"),
        t("benefits.storyosUnlimited"),
        t("benefits.storyosMessages", { count: 200 }),
        t("benefits.storyosRetention", { days: 15 }),
      ],
    },
    VIP3: {
      addCourse: true,
      output: { images: 300, videos: 120, tmin: 24, tmax: 28, agents: 720 },
      storyos: [
        t("benefits.storyosFull"),
        t("benefits.storyosUnlimited"),
        t("benefits.storyosMessages", { count: 500 }),
        t("benefits.storyosRetention", { days: 15 }),
        t("benefits.storyosPriority"),
      ],
    },
  };

  const displayName = (name: string) => planNames[name] || name;
  const displayPrice = (amount: number | string) => {
    const num = Number(amount);
    return siteConfig.region === "cn" ? (num / 100).toFixed(2) : num.toFixed(2);
  };

  const getBenefits = (pkg: VipPackage): BenefitGroup[] => {
    const rights = parseRights(pkg.rights);
    const score = rights.score ?? 0;
    const discountRate = rights.integralDiscount ?? pkg.integralDiscountRate;
    const showDiscount = typeof discountRate === "number" && discountRate > 0 && discountRate < 100;
    const extras = planExtras[pkg.packageName];

    const creditsItems = [t("benefits.bonusCredits", { value: score.toLocaleString() })];
    if (showDiscount) {
      creditsItems.push(
        t("benefits.creditDiscount", {
          percent: 100 - discountRate,
          discount: discountRate / 10,
        })
      );
    }
    if (extras?.addCourse) {
      creditsItems.push(t("benefits.freeCourses"));
    }

    const groups: BenefitGroup[] = [{ items: creditsItems }];
    if (extras) {
      groups.push({
        title: t("benefits.outputTitle"),
        items: [
          t("benefits.outputImagesVideos", {
            images: extras.output.images,
            videos: extras.output.videos,
          }),
          t("benefits.outputTime", { min: extras.output.tmin, max: extras.output.tmax }),
          t("benefits.outputAgents", { count: extras.output.agents }),
        ],
      });
      groups.push({ title: "StoryOS", items: extras.storyos });
    }
    return groups;
  };
  const currencySymbol = siteConfig.currencies.find((c) => c.code === currency)?.symbol ?? "$";

  const bestValueId = useMemo(() => {
    if (packages.length < 2) return packages[0]?.id ?? null;
    return packages[1].id;
  }, [packages]);

  // ── Fetch ───────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSelectedId(null);
    backendApi
      .post<VipPackage[]>("/api/payment/query/vip/package", { data: { currency } })
      .then((res) => {
        const list = (res ?? [])
          .filter((p) => p.status === 1 || p.status === "ACTIVE")
          .sort((a, b) => a.sortOrder - b.sortOrder);
        setPackages(list);
        if (list.length > 0) {
          setSelectedId(list[Math.min(1, list.length - 1)].id);
        }
      })
      .catch(() => setPackages([]))
      .finally(() => setLoading(false));
  }, [open, currency]);

  useEffect(() => {
    if (!open) {
      setStep("select");
      setQrUrl("");
      setOrderNo("");
      setPaying(false);
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
  }, [open]);

  useEffect(
    () => () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    },
    []
  );

  // ── Payment ─────────────────────────────────────────────

  const handlePay = useCallback(async () => {
    if (!selectedPackage) return;
    setPaying(true);
    try {
      if (siteConfig.region === "cn") {
        // WeChat Pay: show QR code
        const result = await backendApi.post<RechargeResult>("/api/payment/wechat/recharge", {
          data: { packageId: selectedPackage.id, type: 2 },
        });
        const qrDataUrl = await QRCode.toDataURL(result.url, { width: 256, margin: 2 });
        setQrUrl(qrDataUrl);
        setOrderNo(result.orderNo);
        setStep("payment");
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
          try {
            const s = await backendApi.get<OrderStatus>(
              `/api/payment/order/status/${result.orderNo}`
            );
            if (s.status === 1) {
              if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
              }
              setStep("success");
              onSuccess?.();
            }
          } catch {
            /* ignore */
          }
        }, 3000);
      } else {
        // Airwallex: redirect to payment page
        const result = await backendApi.post<{ checkoutUrl: string; orderNo: string }>(
          "/api/payment/order/create",
          {
            data: {
              productId: selectedPackage.id,
              productType: 2, // "vip",
              // successUrl: `${window.location.origin}${window.location.pathname}?payment=success`,
              // cancelUrl: `${window.location.origin}${window.location.pathname}?payment=cancelled`,
            },
          }
        );
        if (result.checkoutUrl) {
          if (window.self !== window.top) {
            window.parent.postMessage({ type: "navigateToPayment", url: result.checkoutUrl }, "*");
          } else {
            window.location.href = result.checkoutUrl;
          }
        }
      }
    } catch (e) {
      console.error("[UpgradeDialog]", e);
    } finally {
      setPaying(false);
    }
  }, [selectedPackage, onSuccess]);

  const handleAlreadyPaid = useCallback(async () => {
    if (!orderNo) return;
    try {
      const s = await backendApi.get<OrderStatus>(`/api/payment/order/status/${orderNo}`);
      if (s.status === 1) {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        setStep("success");
        onSuccess?.();
      }
    } catch {
      /* ignore */
    }
  }, [orderNo, onSuccess]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-background">
      {/* Light rays background */}
      <div className="absolute inset-0">
        <LightRays
          raysOrigin="top-center"
          raysColor="#ffffff"
          raysSpeed={1}
          lightSpread={0.5}
          rayLength={3}
          fadeDistance={1}
          saturation={1}
          followMouse
          mouseInfluence={0.1}
          className="h-full w-full"
        />
      </div>

      {/* Close */}
      <button
        type="button"
        onClick={() => onOpenChange(false)}
        className="fixed right-3 top-3 z-20 flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:right-6 sm:top-6"
      >
        <IconX className="size-5" />
      </button>

      {/* Content */}
      <div className="absolute inset-0 z-10 flex flex-col items-center overflow-y-auto px-6 py-20 sm:px-8 sm:py-16">
        {/* Header */}
        <div className="mb-3 inline-flex items-center justify-center rounded-full bg-white/10 p-3">
          <IconCrown className="size-8 text-white" />
        </div>
        <h1 className="mb-2 text-2xl font-bold sm:text-3xl">{t("upgrade")}</h1>
        <p className="mb-6 max-w-md px-4 text-center text-sm text-muted-foreground sm:text-base">
          {t("unlockMore")}
        </p>

        {/* Currency switcher (only for global with multiple currencies) */}
        {siteConfig.currencies.length > 1 && (
          <div className="mb-10 flex items-center justify-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1">
            {siteConfig.currencies.map((c) => (
              <button
                key={c.code}
                type="button"
                onClick={() => setCurrency(c.code)}
                className={cn(
                  "rounded-full px-4 py-1.5 text-sm font-medium transition-all",
                  currency === c.code
                    ? "bg-white/10 text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {c.symbol} {c.code}
              </button>
            ))}
          </div>
        )}

        {step === "select" && (
          <>
            {loading ? (
              <div className="flex h-48 items-center justify-center">
                <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="grid w-full max-w-4xl grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {packages.map((pkg) => {
                  const isSelected = selectedId === pkg.id;
                  const isBest = bestValueId === pkg.id;
                  const benefits = getBenefits(pkg);
                  return (
                    <div
                      key={pkg.id}
                      onClick={() => setSelectedId(pkg.id)}
                      className={cn(
                        "relative flex cursor-pointer flex-col rounded-2xl border p-6 text-left backdrop-blur-sm transition-all",
                        isSelected
                          ? "border-white/40 bg-white/5 shadow-lg shadow-white/5"
                          : "border-white/10 bg-white/[0.02] hover:border-white/20"
                      )}
                    >
                      {isBest && (
                        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-black">
                          {t("popular")}
                        </span>
                      )}

                      {/* Name */}
                      <div className="text-lg font-bold">{displayName(pkg.packageName)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {pkg.description || `${pkg.durationDays} ${t("days")}`}
                      </div>

                      {/* Price */}
                      <div className="mt-4 mb-1">
                        <span className="text-3xl font-bold">
                          <span className="text-lg font-normal text-muted-foreground">
                            {currencySymbol}
                          </span>
                          {displayPrice(pkg.price)}
                        </span>
                        {pkg.durationDays >= 30 && (
                          <span className="ml-1 text-sm text-muted-foreground">
                            /{t("perMonth").replace("/", "")}
                          </span>
                        )}
                      </div>
                      <div className="mb-5 text-xs text-muted-foreground/60">
                        {pkg.durationDays >= 30
                          ? t("billingPeriod", { days: pkg.durationDays, unit: t("days") })
                          : `${pkg.durationDays} ${t("days")}`}
                      </div>

                      {/* Subscribe button */}
                      <div className="mb-6">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedId(pkg.id);
                            if (isSelected) void handlePay();
                          }}
                          disabled={isSelected && paying}
                          className={cn(
                            "w-full rounded-full py-2.5 text-center text-sm font-medium transition-colors",
                            isSelected
                              ? "bg-primary text-primary-foreground hover:bg-primary-hover"
                              : "bg-white/10 text-white hover:bg-white/15"
                          )}
                        >
                          {isSelected && paying ? (
                            <IconLoader2 className="mx-auto size-4 animate-spin" />
                          ) : isSelected ? (
                            siteConfig.region === "cn" ? (
                              t("wechatPay")
                            ) : (
                              t("payNow")
                            )
                          ) : (
                            t("selectPlan")
                          )}
                        </button>
                      </div>

                      {/* Benefits */}
                      <div className="mt-auto space-y-4">
                        {benefits.map((group, gi) => (
                          <div key={gi}>
                            {group.title && (
                              <div className="mb-2 flex items-center gap-1.5">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-primary/80">
                                  {group.title}
                                </span>
                                <div className="flex-1 border-t border-white/8" />
                              </div>
                            )}
                            <ul className="space-y-2">
                              {group.items.map((b, i) => (
                                <li
                                  key={i}
                                  className="flex items-start gap-2 text-sm text-muted-foreground"
                                >
                                  <IconCheck className="mt-0.5 size-4 shrink-0 text-white" />
                                  <span>{b}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Disclaimer */}
            <p className="mt-10 max-w-2xl text-center text-xs leading-relaxed text-muted-foreground/40">
              {t("disclaimer")}
            </p>
          </>
        )}

        {step === "payment" && (
          <div className="flex flex-col items-center">
            <h2 className="mb-2 text-xl font-semibold">{t("wechatPay")}</h2>
            <p className="mb-8 text-sm text-muted-foreground">{t("scanToPay")}</p>
            <div className="mb-8 rounded-2xl bg-white p-5">
              <img src={qrUrl} alt="QR" className="size-56" />
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                color="muted"
                onClick={() => {
                  if (pollRef.current) {
                    clearInterval(pollRef.current);
                    pollRef.current = null;
                  }
                  setQrUrl("");
                  setOrderNo("");
                  setStep("select");
                }}
              >
                {t("changePlan")}
              </Button>
              <Button variant="soft" onClick={() => void handleAlreadyPaid()}>
                {t("alreadyPaid")}
              </Button>
            </div>
          </div>
        )}

        {step === "success" && (
          <div className="flex flex-col items-center">
            <div className="mb-5 flex size-20 items-center justify-center rounded-full bg-white/10">
              <IconCircleCheckFilled className="size-12 text-white" />
            </div>
            <h2 className="mb-2 text-xl font-semibold">{t("paymentSuccess")}</h2>
            <p className="mb-8 text-sm text-muted-foreground">{t("paymentSuccessDesc")}</p>
            <Button onClick={() => onOpenChange(false)}>{t("close")}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
