import { useRef, useState } from "react";
import { IconCamera, IconLoader2, IconLink, IconCopy, IconCheck } from "@tabler/icons-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useTranslations } from "@/src/i18n/i18n";
import { buildOssUrl } from "@/src/lib/uploads/workspace-upload";
import { Button } from "@/components/ui/button";

interface UserInfo {
  nickName?: string;
  userName?: string;
  name?: string;
  headImg?: string;
  avatar?: string;
  description?: string;
  userLevel?: string;
  [key: string]: unknown;
}

function resolveAvatarUrl(info: UserInfo | null) {
  const raw = info?.headImg || info?.avatar;
  if (!raw) return "";
  return buildOssUrl(String(raw));
}

interface ProfileHeaderProps {
  userInfo: UserInfo | null;
  onAvatarUploaded: (path: string) => void;
  onEditProfile: () => void;
}

export function ProfileHeader({ userInfo, onAvatarUploaded, onEditProfile }: ProfileHeaderProps) {
  const t = useTranslations("profile");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [referralLink, setReferralLink] = useState("");
  const [referralDialogOpen, setReferralDialogOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const info = userInfo;
  const displayName = info?.nickName || info?.userName || info?.name || "User";
  const initials = displayName.slice(0, 1).toUpperCase();

  const handleAvatarClick = () => fileInputRef.current?.click();

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
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

    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/content/user/uploadAratar", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const body = await res.json();
      if (body?.code === 200 && body?.path) {
        onAvatarUploaded(body.path);
        toast.success(t("avatarUpdated"));
      } else {
        toast.error(t("avatarUploadFailed"));
      }
    } catch {
      toast.error(t("avatarUploadFailed"));
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleGenerateReferralLink = async () => {
    setGeneratingLink(true);
    try {
      const res = await fetch("/user/recommendationcode", { credentials: "include" });
      const body = await res.json();
      if ((body?.code === 200 || body?.code === "SUCCESS") && body?.info) {
        const code = String(body.info);
        const link = `${window.location.origin}/register?recommendationCode=${code}`;
        setReferralLink(link);
        setCopied(false);
        setReferralDialogOpen(true);
      } else {
        toast.error(t("referralLinkFailed"));
      }
    } catch {
      toast.error(t("referralLinkFailed"));
    } finally {
      setGeneratingLink(false);
    }
  };

  return (
    <>
      {/* Banner container: background + user info at bottom */}
      <div className="relative flex h-75 w-full items-end overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f3460]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(229,34,39,0.2),transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(80,120,255,0.15),transparent_50%)]" />
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImEiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjAzKSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3QgZmlsbD0idXJsKCNhKSIgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIvPjwvc3ZnPg==')] opacity-50" />
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/40 to-transparent" />

        <div className="relative mx-auto flex w-full max-w-5xl items-end justify-between px-8 pb-6">
          {/* Left: Avatar + Info */}
          <div className="flex max-w-3xl flex-col gap-3">
            <div className="flex items-center space-x-4">
              {/* Avatar */}
              <div className="group relative shrink-0">
                <Avatar className="size-24 border-3 border-white/20 text-3xl shadow-2xl">
                  <AvatarImage src={resolveAvatarUrl(info)} alt={displayName} />
                  <AvatarFallback className="bg-muted text-muted-foreground">
                    {initials}
                  </AvatarFallback>
                </Avatar>
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
                  onChange={(e) => void handleAvatarChange(e)}
                />
              </div>

              <div>
                <h1 className="text-2xl font-bold text-white">{displayName}</h1>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2 py-px text-[10px] font-medium text-green-400">
                    Free
                  </span>
                  <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-px text-[10px] font-medium text-primary">
                    Creator
                  </span>
                  <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-px text-[10px] font-medium text-blue-400">
                    29,000 Available
                  </span>
                </div>
              </div>
            </div>

            <p className="text-[13px] leading-relaxed text-white/60">
              {info?.description ||
                "Subscribe to learn about new product features, the latest in technology, solutions, and updates."}
            </p>
          </div>

          {/* Right: Actions */}
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-white/20 bg-white/5 text-white hover:bg-white/10"
              onClick={() => void handleGenerateReferralLink()}
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

      {/* Referral Link Dialog */}
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
    </>
  );
}
