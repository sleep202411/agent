import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  IconCamera,
  IconLoader2,
  IconLink,
  IconCopy,
  IconCheck,
  IconPhoto,
  IconShieldCheck,
  IconShare2,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/user-avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { env } from "@/src/env";
import {
  useUploadAvatar,
  useUploadBanner,
  useReferralCode,
  useUpdateUserInfo,
} from "@/src/hooks/use-user";
import { useMyCertifications, useCertificationRoles } from "@/src/hooks/use-certification";
import { AUTH_STATUS } from "@/src/services/certification";
import { CertificationDialog } from "./certification-dialog";
import type { UserInfo, UserInfoResolved } from "@/src/services/user";

/**
 * Real-name verification status badge config. Backend reuses the same
 * AUTH_STATUS enum on `userInfo.authStatus` as the role-cert table
 * (0 pending, 3 rejected, 5 approved). Anything else (null / undefined /
 * unknown number) → user hasn't started the flow, render "去认证".
 */
type KycChipVariant = "verified" | "pending" | "rejected" | "unverified";
function resolveKycVariant(status: number | undefined | null): KycChipVariant {
  if (status === AUTH_STATUS.APPROVED) return "verified";
  if (status === AUTH_STATUS.PENDING) return "pending";
  if (status === AUTH_STATUS.REJECTED) return "rejected";
  return "unverified";
}

function resolveAvatarUrl(info: UserInfo | null) {
  const raw = info?.headImg || info?.avatar;
  if (!raw) return "";
  if (raw.startsWith("http")) return raw;
  const base = env.USER_BASE_URL || env.OSS_BASE_URL;
  return `${base}/${raw}`;
}

interface ProfileHeaderProps {
  /** Resolved variant carries `levels` (FD-IV chips) and OSS-resolved
   *  `headImgUrl` / `bannerUrl` fields the rendering relies on. */
  userInfo: UserInfoResolved | null;
  onEditProfile: () => void;
}

export function ProfileHeader({ userInfo, onEditProfile }: ProfileHeaderProps) {
  const t = useTranslations("profile");
  const tk = useTranslations("kyc");
  const tc = useTranslations("common");
  const router = useRouter();
  const [referralLink, setReferralLink] = useState("");
  const [referralDialogOpen, setReferralDialogOpen] = useState(false);
  const [certDialogOpen, setCertDialogOpen] = useState(false);
  const [availableAlertOpen, setAvailableAlertOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const kycVariant = resolveKycVariant(userInfo?.authStatus);
  const kycChipLabel = {
    verified: tk("statusVerified"),
    pending: tk("statusPending"),
    rejected: tk("statusRejected"),
    unverified: tk("goVerify"),
  }[kycVariant];
  const kycChipClass = {
    verified: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    pending: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    rejected: "border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20",
    unverified: "border-white/20 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white",
  }[kycVariant];
  // Verified/pending = no action needed. Rejected/unverified = click to go re-verify.
  const kycClickable = kycVariant !== "verified" && kycVariant !== "pending";

  const { mutate: doUpdateUserInfo } = useUpdateUserInfo();
  const { mutate: doUploadAvatar, isPending: uploadingAvatar } = useUploadAvatar();
  const { mutate: doUploadBanner, isPending: uploadingCover } = useUploadBanner();
  const { mutate: doGetReferralCode, isPending: generatingLink } = useReferralCode();
  const { data: certifications } = useMyCertifications();
  const { data: certRoles } = useCertificationRoles();

  // Approved certifications → badges
  const approvedCerts = (certifications ?? []).filter((c) => c.authStatus === AUTH_STATUS.APPROVED);
  const certBadges = approvedCerts
    .map((c) => {
      const roleName = certRoles?.[String(c.authRoleId)] ?? "";
      return { id: c.id, name: roleName };
    })
    .filter((b) => b.name);

  const info = userInfo;
  const displayName = info?.nickName || info?.userName || info?.name || "User";
  const initials = displayName.slice(0, 1).toUpperCase();
  // Default-visible: treat undefined / null as opted-in. Only an explicit
  // `false` from the backend means hidden. Keeps existing users discoverable
  // in the talent market without forcing them to flip a switch first.
  const isVisibleInMarket = (info as Record<string, unknown>)?.availableForWork !== false;

  const handleAvatarClick = () => fileInputRef.current?.click();

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    if (!file.type.startsWith("image/")) {
      toast.error(t("pleaseUploadImage"));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t("avatarSizeLimit"));
      return;
    }

    doUploadAvatar(file, {
      onSuccess: () => toast.success(t("avatarUpdated")),
      onError: () => toast.error(t("avatarUploadFailed")),
    });
  };

  const handleGenerateReferralLink = () => {
    doGetReferralCode(undefined, {
      onSuccess: (code) => {
        const link = `${window.location.origin}/register?recommendationCode=${code}`;
        setReferralLink(link);
        setCopied(false);
        setReferralDialogOpen(true);
      },
      onError: () => toast.error(t("referralLinkFailed")),
    });
  };

  const coverUrl = info?.banner
    ? info.banner.startsWith("http")
      ? info.banner
      : `${env.BANNER_BASE_URL}/${info.banner}`
    : "";

  const handleCoverChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    if (!file.type.startsWith("image/")) {
      toast.error(t("pleaseUploadImage"));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t("coverSizeLimit"));
      return;
    }
    doUploadBanner(file, {
      onSuccess: () => toast.success(t("coverUpdated")),
      onError: () => toast.error(t("coverUploadFailed")),
    });
  };

  return (
    <>
      <div className="group/banner relative flex h-75 w-full items-end overflow-hidden">
        {/* Cover image or default gradient */}
        {coverUrl ? (
          <img src={coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <>
            <div className="absolute inset-0 bg-linear-to-br from-[#1a1a2e] via-[#16213e] to-[#0f3460]" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(229,34,39,0.2),transparent_50%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(80,120,255,0.15),transparent_50%)]" />
          </>
        )}
        <div className="absolute inset-x-0 bottom-0 h-32 bg-linear-to-t from-black/40 to-transparent" />

        <button
          type="button"
          onClick={() => coverInputRef.current?.click()}
          disabled={uploadingCover}
          className="absolute right-4 top-4 z-10 flex items-center gap-1.5 rounded-lg bg-black/40 px-3 py-1.5 text-xs text-white/80 opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/60 hover:text-white group-hover/banner:opacity-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {uploadingCover ? (
            <IconLoader2 className="size-3.5 animate-spin" />
          ) : (
            <IconPhoto className="size-3.5" />
          )}
          {t("changeCover")}
        </button>
        <input
          ref={coverInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleCoverChange}
        />

        <div className="relative mx-auto flex w-full max-w-6xl items-end justify-between px-4 pb-6">
          <div className="flex max-w-3xl flex-col gap-3">
            <div className="flex items-center space-x-4">
              <div className="group relative shrink-0">
                <UserAvatar
                  src={resolveAvatarUrl(info)}
                  seed={info?.id}
                  name={displayName}
                  className="size-24 border-3 border-white/20 shadow-2xl"
                />
                <button
                  type="button"
                  onClick={handleAvatarClick}
                  disabled={uploadingAvatar}
                  className="absolute inset-1 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  {uploadingAvatar ? (
                    <IconLoader2 className="size-5 animate-spin text-white" />
                  ) : (
                    <IconCamera className="size-5 text-white" />
                  )}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarChange}
                />
              </div>

              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold text-white">{displayName}</h1>
                  <button
                    type="button"
                    onClick={() => setAvailableAlertOpen(true)}
                    className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      isVisibleInMarket
                        ? "bg-green-500/15 text-green-400 hover:bg-green-500/25"
                        : "bg-white/10 text-white/50 hover:bg-white/15 hover:text-white/70"
                    }`}
                  >
                    <span
                      className={`size-2 rounded-full ${isVisibleInMarket ? "bg-green-400" : "bg-white/30"}`}
                    />
                    {isVisibleInMarket ? t("available") : t("unavailable")}
                  </button>
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  {info?.userLevel && (
                    <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-px text-[10px] font-medium text-primary">
                      {info.userLevel}
                    </span>
                  )}
                  {(info?.levels ?? []).map((lvl) => (
                    <span
                      key={lvl.id}
                      title={lvl.description ?? lvl.name}
                      className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 py-px pl-1 pr-2 text-[10px] font-medium text-amber-300"
                    >
                      {lvl.iconUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={lvl.iconUrl}
                          alt=""
                          className="size-3.5 shrink-0 rounded-full object-cover"
                        />
                      ) : null}
                      {lvl.name}
                    </span>
                  ))}
                  {certBadges.map((badge) => (
                    <span
                      key={badge.id}
                      className="rounded-full border border-green-500/30 bg-green-500/10 px-2 py-px text-[10px] font-medium text-green-400"
                    >
                      {badge.name}
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => setCertDialogOpen(true)}
                    className="rounded-full border border-white/20 bg-white/5 px-2 py-px text-[10px] text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    {certBadges.length > 0 ? t("manageCert") : t("addCertification")}
                  </button>
                  {/* Real-name verification (KYC) is a China-specific
                      regulatory requirement; the global / .com region
                      doesn't enroll users in this flow. The backend
                      defaults `authStatus = 0` for every fresh account
                      regardless of region, so without this gate every
                      .com user would see a permanent "Under review"
                      chip even though they never started KYC. */}
                  {env.SITE_REGION !== "global" && (
                    <button
                      type="button"
                      disabled={!kycClickable}
                      onClick={() => {
                        if (kycClickable) router.push("/kyc");
                      }}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-px text-[10px] font-medium transition-colors ${kycChipClass} ${
                        kycClickable ? "" : "cursor-default"
                      }`}
                    >
                      <IconShieldCheck className="size-3" />
                      {kycChipLabel}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {info?.description && (
              <p className="text-[13px] leading-relaxed text-white/60">{info.description}</p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-white/20 bg-white/5 text-white hover:bg-white/10"
              onClick={async () => {
                if (!info?.id) return;
                const link = `${window.location.origin}/creators/${info.id}`;
                try {
                  await navigator.clipboard.writeText(link);
                  toast.success(t("profileLinkCopied"));
                } catch {
                  toast.error(tc("copyFailed"));
                }
              }}
              disabled={!info?.id}
            >
              <IconShare2 className="size-3.5" />
              {t("shareProfile")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-white/20 bg-white/5 text-white hover:bg-white/10"
              onClick={handleGenerateReferralLink}
              disabled={generatingLink}
            >
              {generatingLink ? (
                <IconLoader2 className="size-3.5 animate-spin" />
              ) : (
                <IconLink className="size-3.5" />
              )}
              {t("generateReferralLink")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-white/20 bg-white/5 text-white hover:bg-white/10"
              onClick={onEditProfile}
            >
              {t("editProfile")}
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={referralDialogOpen} onOpenChange={setReferralDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("referralLinkTitle")}</DialogTitle>
            <DialogDescription>{t("referralLinkDesc")}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 p-4">
            <input
              readOnly
              value={referralLink}
              className="h-10 flex-1 rounded-lg border border-border bg-muted px-3 text-sm text-foreground"
              onFocus={(e) => e.target.select()}
            />
            <Button
              size="sm"
              variant={copied ? "outline" : "solid"}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(referralLink);
                  setCopied(true);
                  toast.success(t("referralLinkCopied"));
                } catch {
                  toast.error(t("referralLinkManualCopy"));
                }
              }}
            >
              {copied ? <IconCheck className="size-4" /> : <IconCopy className="size-4" />}
              {copied ? t("copied") : t("copy")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <CertificationDialog open={certDialogOpen} onOpenChange={setCertDialogOpen} />

      <AlertDialog open={availableAlertOpen} onOpenChange={setAvailableAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isVisibleInMarket ? t("availableOffTitle") : t("availableOnTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isVisibleInMarket ? t("availableOffDesc") : t("availableOnDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const next = !isVisibleInMarket;
                doUpdateUserInfo({ availableForWork: next } as Record<string, unknown>, {
                  onSuccess: () => toast.success(next ? t("availableOn") : t("availableOff")),
                });
              }}
            >
              {t("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
