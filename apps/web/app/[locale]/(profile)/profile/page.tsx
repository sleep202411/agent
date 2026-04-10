import { useCallback, useEffect, useState } from "react";
import { IconCheck, IconLoader2, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "@/src/i18n/i18n";
import { ProfileHeader } from "./profile-header";

// ─── Types ─────────────────────────────────────────────

interface UserInfo {
  id?: string;
  nickName?: string;
  userName?: string;
  name?: string;
  phone?: string;
  email?: string;
  contact?: string;
  headImg?: string;
  avatar?: string;
  description?: string;
  other?: string;
  userLevel?: string;
  authStatus?: number;
  [key: string]: unknown;
}

const MOCK_USER: UserInfo = {
  id: "1",
  nickName: "Drew Cano",
  email: "drew@fizzdragon.com",
  phone: "+65 8888 6666",
  contact: "WeChat: drewcano\nTelegram: @drewcano",
  description:
    "Subscribe to learn about new product features, the latest in technology, solutions, and updates. A passionate creator focused on storytelling and visual production.",
  other: "https://dribbble.com/drewcano\nhttps://behance.net/drewcano",
  userLevel: "Creator",
};

// ─── Page ──────────────────────────────────────────────

export default function ProfilePage() {
  const t = useTranslations("profile");
  const tc = useTranslations("common");

  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [nickName, setNickName] = useState("");
  const [contact, setContact] = useState("");
  const [description, setDescription] = useState("");
  const [other, setOther] = useState("");

  // ─── Fetch user info ─────────────────────────────────

  const fetchUserInfo = useCallback(async () => {
    try {
      const res = await fetch("/user/query/user/info", { credentials: "include" });
      const body = await res.json();
      const info: UserInfo = body?.info ?? body?.data?.info ?? body?.data ?? {};
      setUserInfo(info);
    } catch {
      setUserInfo(MOCK_USER);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUserInfo();
  }, [fetchUserInfo]);

  // ─── Edit ────────────────────────────────────────────

  const handleStartEdit = () => {
    const info = userInfo ?? MOCK_USER;
    setNickName(info.nickName ?? "");
    setContact(info.contact ?? "");
    setDescription(info.description ?? "");
    setOther(info.other ?? "");
    setEditing(true);
  };

  const handleCancelEdit = () => setEditing(false);

  const handleSave = async () => {
    if (!nickName.trim()) {
      toast.warning(t("nicknameRequired"));
      return;
    }
    setSaving(true);
    try {
      await fetch("/user/update/user/info", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickName: nickName.trim(),
          contact: contact.trim(),
          description: description.trim(),
          other: other.trim(),
        }),
      });
      toast.success(t("updateSuccess"));
      setEditing(false);
      void fetchUserInfo();
    } catch {
      toast.error(t("updateFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUploaded = (path: string) => {
    setUserInfo((prev) => (prev ? { ...prev, headImg: path, avatar: path } : prev));
  };

  // ─── Render ──────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ProfileHeader
        userInfo={userInfo ?? MOCK_USER}
        onAvatarUploaded={handleAvatarUploaded}
        onEditProfile={handleStartEdit}
      />

      {/* Tabs */}
      <div className="relative mx-auto max-w-5xl px-8">
        <ProfileTabs onEditProfile={handleStartEdit} />
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg space-y-5 rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t("editProfile")}</h2>
              <button
                type="button"
                onClick={handleCancelEdit}
                className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
              >
                <IconX className="size-4" />
              </button>
            </div>

            <FieldRow label={t("nickname")} required>
              <Input
                value={nickName}
                onChange={(e) => setNickName(e.target.value)}
                placeholder={t("enterNickname")}
                maxLength={100}
              />
            </FieldRow>
            <FieldRow label={t("contact")}>
              <Textarea
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder={t("enterContact")}
                maxLength={200}
                rows={2}
              />
            </FieldRow>
            <FieldRow label={t("bio")}>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("enterBio")}
                maxLength={2000}
                rows={4}
              />
            </FieldRow>
            <FieldRow label={t("portfolio")}>
              <Textarea
                value={other}
                onChange={(e) => setOther(e.target.value)}
                placeholder={t("enterPortfolio")}
                maxLength={2000}
                rows={3}
              />
            </FieldRow>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" color="muted" onClick={handleCancelEdit} disabled={saving}>
                {tc("cancel")}
              </Button>
              <Button onClick={() => void handleSave()} disabled={saving}>
                {saving ? (
                  <IconLoader2 className="size-3.5 animate-spin" />
                ) : (
                  <IconCheck className="size-3.5" />
                )}
                {tc("save")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────

function FieldRow({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {children}
    </div>
  );
}

// ─── Tabs ──────────────────────────────────────────────

type ProfileTab = "works" | "projects" | "crews" | "profile";

function ProfileTabs({ onEditProfile }: { onEditProfile: () => void }) {
  const [activeTab, setActiveTab] = useState<ProfileTab>("works");

  const tabs: { key: ProfileTab; label: string }[] = [
    { key: "works", label: "个人作品" },
    { key: "projects", label: "项目作品" },
    { key: "crews", label: "参与剧组" },
    { key: "profile", label: "Profile" },
  ];

  return (
    <div className="mt-6 pb-12">
      <div className="flex items-center gap-1 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={
              activeTab === tab.key
                ? "border-b-2 border-primary px-4 py-2.5 text-sm font-medium text-foreground"
                : "border-b-2 border-transparent px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {activeTab === "works" && <PersonalWorks />}
        {activeTab === "projects" && <ProjectWorks />}
        {activeTab === "crews" && <JoinedCrews />}
        {activeTab === "profile" && <ProfileSettings onEdit={onEditProfile} />}
      </div>
    </div>
  );
}

// ─── Personal Works Tab ────────────────────────────────

function PersonalWorks() {
  const mockWorks = [
    { id: "1", title: "城市黄昏", status: "approved", isPublic: true },
    { id: "2", title: "星际旅途", status: "reviewing", isPublic: true },
    { id: "3", title: "深海探秘", status: "approved", isPublic: false },
    { id: "4", title: "古镇晨雾", status: "failed", isPublic: true },
    { id: "5", title: "赛博朋克", status: "approved", isPublic: true },
    { id: "6", title: "田园风光", status: "approved", isPublic: true },
  ];

  return (
    <div className="grid grid-cols-3 gap-4">
      {mockWorks.map((work) => (
        <div
          key={work.id}
          className="group overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/30"
        >
          <div className="aspect-video bg-muted" />
          <div className="p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{work.title}</span>
              <StatusBadge status={work.status} />
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {work.isPublic ? "公开" : "私密"} · 2 天前
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Project Works Tab ─────────────────────────────────

function ProjectWorks() {
  const mockProjects = [
    { id: "1", title: "火星征途", episodes: 12, status: "online" },
    { id: "2", title: "深海危机", episodes: 8, status: "online" },
    { id: "3", title: "赛博都市", episodes: 20, status: "offline" },
    { id: "4", title: "古风武侠", episodes: 16, status: "online" },
  ];

  return (
    <div className="grid grid-cols-3 gap-4">
      {mockProjects.map((project) => (
        <div
          key={project.id}
          className="group overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/30"
        >
          <div className="aspect-video bg-muted" />
          <div className="p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{project.title}</span>
              <span
                className={
                  project.status === "online"
                    ? "rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-medium text-green-400"
                    : "rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                }
              >
                {project.status === "online" ? "已上线" : "未上线"}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">{project.episodes} 集</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Joined Crews Tab ──────────────────────────────────

function JoinedCrews() {
  const mockCrews = [
    { id: "1", title: "星际远征", role: "摄影师", director: "张导" },
    { id: "2", title: "古镇奇谭", role: "编剧", director: "李导" },
    { id: "3", title: "都市传说", role: "后期剪辑", director: "王导" },
  ];

  return (
    <div className="grid grid-cols-3 gap-4">
      {mockCrews.map((crew) => (
        <div
          key={crew.id}
          className="group overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/30"
        >
          <div className="aspect-video bg-muted" />
          <div className="p-3">
            <span className="text-sm font-medium">{crew.title}</span>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>{crew.role}</span>
              <span>·</span>
              <span>{crew.director}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Profile Settings Tab ──────────────────────────────

function ProfileSettings({ onEdit }: { onEdit: () => void }) {
  const t = useTranslations("profile");
  const mockInfo = [
    { label: "昵称", value: "Drew Cano" },
    { label: "联系方式", value: "WeChat: drewcano\nTelegram: @drewcano" },
    {
      label: "个人简介",
      value:
        "A passionate creator focused on storytelling and visual production. Subscribe to learn about new product features, the latest in technology, solutions, and updates.",
    },
    { label: "其他作品", value: "https://dribbble.com/drewcano\nhttps://behance.net/drewcano" },
    { label: "手机号", value: "+65 8888 6666" },
    { label: "邮箱", value: "drew@fizzdragon.com" },
  ];

  return (
    <div className="max-w-2xl space-y-5 rounded-xl border border-border bg-card p-6">
      {mockInfo.map((item) => (
        <div key={item.label} className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">{item.label}</div>
          <div className="whitespace-pre-wrap text-sm leading-relaxed">{item.value}</div>
        </div>
      ))}
      <div className="pt-2">
        <Button variant="outline" color="muted" size="sm" onClick={onEdit}>
          {t("editProfile")}
        </Button>
      </div>
    </div>
  );
}

// ─── Status Badge ──────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "approved":
      return (
        <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-medium text-green-400">
          已通过
        </span>
      );
    case "reviewing":
      return (
        <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-[10px] font-medium text-yellow-400">
          审核中
        </span>
      );
    case "failed":
      return (
        <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-400">
          未通过
        </span>
      );
    default:
      return null;
  }
}
