import { useEffect, useMemo, useState } from "react";
import { PanelAnimateContext } from "@/components/project/panels/panel-layout";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useTranslations } from "@/src/i18n/i18n";
import { ProjectHeader } from "@/components/project/project-header";
import { ProjectSidebar } from "@/components/project/project-sidebar";
import { AiAssistantPanel } from "@/components/project/ai-assistant-panel";
import { ScriptView } from "@/components/project/script-view";
import { StoryboardView } from "@/components/project/storyboard-view";
import { TimelineView } from "@/components/project/timeline";
import { CharactersPanel } from "@/components/project/panels/characters";
import { EditWorldPanel } from "@/components/project/panels/edit-world-panel";
import { EpisodesPanel } from "@/components/project/panels/episodes";
import { InspirationPanel } from "@/components/project/panels/inspiration-panel";
import { MusicPanel } from "@/components/project/panels/music";
import { AssetsPanel } from "@/components/project/panels/assets";
import { ProjectsPanel } from "@/components/project/panels/projects-panel";
import { PropsPanel } from "@/components/project/panels/props";
import { ScenesPanel } from "@/components/project/panels/scenes";
import { cn } from "@/lib/utils";
import { useProjectDetail } from "@/src/hooks/use-project-detail";
import { useStoryboardData } from "@/src/hooks/use-storyboard-data";
import { useAiModelsPreload } from "@/src/hooks/use-ai-models";
import { useWorldAssets } from "@/src/hooks/use-world-assets";
import { useAppSelector } from "@/src/store";
import { store } from "@/src/store";
import { setActivePanel, selectCurrentInstance } from "@/src/store/slices/projectSlice";

export default function ProjectDetailPage() {
  const t = useTranslations("project");
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const { detail, isLoading, isEpisodesLoading, error } = useProjectDetail();
  useStoryboardData();
  useWorldAssets();
  useAiModelsPreload();

  const activeTab = useAppSelector((s) => selectCurrentInstance(s).activeTab);
  const [mountedTabs, setMountedTabs] = useState<Record<string, boolean>>({
    storyboard: true,
  });

  const [prevActiveTab, setPrevActiveTab] = useState(activeTab);
  if (prevActiveTab !== activeTab) {
    setPrevActiveTab(activeTab);
    setMountedTabs((prev) => (prev[activeTab] ? prev : { ...prev, [activeTab]: true }));
  }

  const activePanel = useAppSelector((s) => selectCurrentInstance(s).activePanel);
  const [prevPanel, setPrevPanel] = useState(activePanel);
  if (prevPanel !== activePanel) {
    setPrevPanel(activePanel);
  }
  const shouldAnimatePanel = prevPanel == null && activePanel != null;
  const activeEpisodeId = useAppSelector((s) => selectCurrentInstance(s).activeEpisodeId);
  const projectId = useAppSelector((s) => s.project.currentProjectId);
  const worldId = useAppSelector((s) => selectCurrentInstance(s).worldId);

  useEffect(() => {
    // 读取当前 URL 参数（不通过 searchParams 避免循环依赖）
    const currentParams = new URLSearchParams(window.location.search);
    const params = new URLSearchParams(currentParams.toString());
    let changed = false;

    if (worldId && params.get("worldId") !== worldId) {
      params.set("worldId", worldId);
      changed = true;
    }

    if (activeEpisodeId && params.get("episodeId") !== activeEpisodeId) {
      params.set("episodeId", activeEpisodeId);
      changed = true;
    }

    if (!activeEpisodeId && params.has("episodeId")) {
      params.delete("episodeId");
      changed = true;
    }

    if (!changed) return;
    const query = params.toString();
    void navigate({ to: query ? `${pathname}?${query}` : pathname, replace: true });
  }, [activeEpisodeId, pathname, navigate, worldId]);

  const panelContent = useMemo(() => {
    switch (activePanel) {
      case "projects":
        return <ProjectsPanel onClose={() => store.dispatch(setActivePanel(null))} />;
      case "episodes":
        return <EpisodesPanel onClose={() => store.dispatch(setActivePanel(null))} />;
      case "characters":
        return <CharactersPanel onClose={() => store.dispatch(setActivePanel(null))} />;
      case "scenes":
        return <ScenesPanel onClose={() => store.dispatch(setActivePanel(null))} />;
      case "props":
        return <PropsPanel onClose={() => store.dispatch(setActivePanel(null))} />;
      case "editWorld":
        return <EditWorldPanel onClose={() => store.dispatch(setActivePanel(null))} />;
      case "myAssets":
        return <AssetsPanel onClose={() => store.dispatch(setActivePanel(null))} />;
      case "music":
        return <MusicPanel onClose={() => store.dispatch(setActivePanel(null))} />;
      case "inspiration":
        return <InspirationPanel onClose={() => store.dispatch(setActivePanel(null))} />;
      case "aiAssistant":
        return <AiAssistantPanel onClose={() => store.dispatch(setActivePanel(null))} />;
      default:
        return null;
    }
  }, [activePanel]);

  // 必要接口未完成前显示全屏 loading
  const essentialLoading = isLoading || isEpisodesLoading || (!detail && !error);

  if (essentialLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="size-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
          <p className="text-sm text-muted-foreground">{t("loadingProject")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <ProjectHeader projectName={detail?.name ?? ""} isLoading={false} />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ProjectSidebar />

        <PanelAnimateContext.Provider value={shouldAnimatePanel}>
          {panelContent}
        </PanelAnimateContext.Provider>

        <div className="min-h-0 min-w-0 flex-1 pr-4 pb-4">
          <div className="h-full p-4 rounded-xl overflow-hidden bg-card">
            {error ? (
              <div className="flex h-full items-center justify-center">
                <div className="rounded-3xl border border-destructive/20 bg-destructive/5 px-6 py-5 text-center">
                  <div className="text-base font-semibold text-destructive">
                    {t("loadProjectFailed")}
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">{error}</div>
                </div>
              </div>
            ) : (
              <>
                {mountedTabs.script && (
                  <div className={cn("h-full", activeTab !== "script" && "hidden")}>
                    <ScriptView />
                  </div>
                )}
                {mountedTabs.timeline && (
                  <div className={cn("h-full", activeTab !== "timeline" && "hidden")}>
                    <TimelineView />
                  </div>
                )}
                {mountedTabs.storyboard && (
                  <div className={cn("h-full", activeTab !== "storyboard" && "hidden")}>
                    <StoryboardView />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes dragon-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        @keyframes dragon-orbit {
          from { transform: translate(-50%, -50%) rotate(0deg) translateX(22px) rotate(0deg); }
          to { transform: translate(-50%, -50%) rotate(360deg) translateX(22px) rotate(-360deg); }
        }
      `,
        }}
      />
    </div>
  );
}
