import { useState } from "react";
import { IconEdit, IconArrowDown, IconLoader2 } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { useUserInfo } from "@/src/hooks/use-user";
import {
  useMyProjects,
  useMyJoinedProjects,
  useMyPersonalWorks,
} from "@/src/hooks/use-my-projects";
import { updateProject, type Project } from "@/src/services/project";
import { env } from "@/src/env";
import { ProfileHeader } from "./profile-header";
import { ProfileEditDialog } from "./profile-edit-dialog";

export default function ProfilePage() {
  const t = useTranslations("profile");
  const { data: userInfo, isLoading } = useUserInfo();
  const [editOpen, setEditOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ProfileHeader userInfo={userInfo ?? null} onEditProfile={() => setEditOpen(true)} />

      <div className="relative mx-auto max-w-5xl px-8">
        <ProfileTabs />
      </div>

      <ProfileEditDialog open={editOpen} onOpenChange={setEditOpen} userInfo={userInfo ?? null} />
    </div>
  );
}

// ─── Tabs ──────────────────────────────────────────────

type ProfileTab = "works" | "ips" | "joined";

function ProfileTabs() {
  const t = useTranslations("profile");
  const [activeTab, setActiveTab] = useState<ProfileTab>("works");

  const tabs: { key: ProfileTab; label: string }[] = [
    { key: "works", label: t("personalWorks") },
    { key: "ips", label: t("myIPs") },
    { key: "joined", label: t("joinedCrews") },
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
        {activeTab === "works" && <PersonalWorksTab />}
        {activeTab === "ips" && <MyIPsTab />}
        {activeTab === "joined" && <JoinedTab />}
      </div>
    </div>
  );
}

// ─── My IPs Tab ───────────────────────────────────────

function MyIPsTab() {
  const t = useTranslations("profile");
  const { data: projects, isLoading } = useMyProjects();

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!projects?.length) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        {t("noData")}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </div>
  );
}

// ─── Personal Works Tab ───────────────────────────────

function PersonalWorksTab() {
  const t = useTranslations("profile");
  const { data: works, isLoading } = useMyPersonalWorks();

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!works?.length) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        {t("noData")}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
      {works.map((work) => {
        const title = work.title || work.introduction || "";
        const videoPath = work.videoLink || "";
        const bannerPath = work.videoBanner || "";
        const coverUrl = bannerPath
          ? bannerPath.startsWith("http")
            ? bannerPath
            : `${env.OSS_BASE_URL}/${bannerPath}`
          : videoPath
            ? `${env.OSS_BASE_URL}/${videoPath}?x-oss-process=video/snapshot,t_0,m_fast`
            : "";
        const isReviewing = work.review === 0;

        return (
          <div
            key={work.id}
            className="group relative overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/30"
          >
            {isReviewing && (
              <div className="absolute right-2 top-2 z-10 rounded-full bg-yellow-500/80 px-2 py-0.5 text-[10px] font-medium text-white">
                {t("reviewing")}
              </div>
            )}
            <div className="aspect-video overflow-hidden bg-muted">
              {coverUrl ? (
                <img src={coverUrl} alt={title} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-2xl font-bold text-muted-foreground/30">
                  {title.slice(0, 1) || "?"}
                </div>
              )}
            </div>
            <div className="p-3">
              <div className="truncate text-sm font-medium">{title || t("noData")}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Joined Tab ───────────────────────────────────────

function JoinedTab() {
  const t = useTranslations("profile");
  const { data: projects, isLoading } = useMyJoinedProjects();

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!projects?.length) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        {t("noData")}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </div>
  );
}

// ─── Project Card ─────────────────────────────────────

function ProjectCard({ project }: { project: Project }) {
  const t = useTranslations("profile");
  const navigate = useNavigate();
  const bannerUrl = project.bannerLink
    ? project.bannerLink.startsWith("http")
      ? project.bannerLink
      : `${env.BANNER_BASE_URL}/${project.bannerLink}`
    : "";

  return (
    <div
      className="group cursor-pointer overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/30"
      onClick={() => navigate({ to: "/ips/$id", params: { id: String(project.id) } })}
    >
      <div className="aspect-[4/3] overflow-hidden bg-muted">
        {bannerUrl ? (
          <img src={bannerUrl} alt={project.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground/30 text-2xl font-bold">
            {project.name.slice(0, 1)}
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="truncate text-sm font-medium">{project.name}</div>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              navigate({ to: "/ips/$id/edit", params: { id: String(project.id) } });
            }}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <IconEdit className="size-3" />
            {t("edit")}
          </button>
          {project.projectStatus === 0 && (
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  await updateProject({ id: project.id, projectStatus: 8 });
                  toast.success(t("delistSuccess"));
                } catch {
                  toast.error(t("delistFailed"));
                }
              }}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <IconArrowDown className="size-3" />
              {t("delist")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
