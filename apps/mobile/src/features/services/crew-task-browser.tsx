import { CrewSetup } from "./crew-setup";
import { useRouter } from "expo-router";
import { toHref } from "@/lib/navigation";
import { TrustAppeals } from "./trust-appeals";
import { ProjectActivity } from "./project-activity";
import { ProjectDocument } from "./project-document";
import { ProjectResources } from "./project-resources";
import { ProjectProperties } from "./project-properties";
import { CrewMembers } from "./crew-members";
import { AssetOrganization } from "../crew-assets/organization";
import { StudioMedia } from "../crew-assets/studio-media";
import { CrewStudioWorkspace } from "./crew-studio-workspace";
import { TaskWorkflowManagement } from "./task-workflow-management";
import { TaskCycleManagement } from "./task-cycle-management";
import { TaskLabelManagement } from "./task-label-management";
import { EpisodeManagement } from "./episode-management";
import { EpisodeCreate } from "./episode-create";
import { EpisodeTaskTemplate } from "./episode-task-template";
import { AssetTaskProgress } from "./asset-task-progress";
import { TaskFieldManagement } from "./task-field-management";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { AuthedWebView } from "@/components/authed-web-view";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { TaskWorkbench } from "./task-workbench";
import { TaskDetail } from "./task-detail";
import { TaskViewBrowser } from "./task-view-browser";

export function CrewTaskBrowser({
  crewId,
  userId,
  generation,
  onClose,
  initialTaskId,
  initialSection,
}: {
  initialTaskId?: string;
  initialSection?: "members" | "setup" | "studio";
  crewId: string;
  userId: string;
  generation: number;
  onClose: () => void;
}) {
  const t = useTranslations();
  const [showSetup, setShowSetup] = useState(initialSection === "setup");
  const [showAppeals, setShowAppeals] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [showDocument, setShowDocument] = useState(false);
  const [showProjectProperties, setShowProjectProperties] = useState(false);
  const [showResources, setShowResources] = useState(false);
  const router = useRouter();
  const [showMembers, setShowMembers] = useState(initialSection === "members");
  const [managingEpisodes, setManagingEpisodes] = useState(false);
  const [creatingEpisode, setCreatingEpisode] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [assetOrganization, setAssetOrganization] = useState(false);
  const [studioMedia, setStudioMedia] = useState(false);
  const [studioWorkspace, setStudioWorkspace] = useState(initialSection === "studio");
  const [managingWorkflows, setManagingWorkflows] = useState(false);
  const [managingCycles, setManagingCycles] = useState(false);
  const [managingLabels, setManagingLabels] = useState(false);
  const [managingFields, setManagingFields] = useState(false);
  const [creating, setCreating] = useState(false);
  const [viewId, setViewId] = useState<string>();
  const [taskId, setTaskId] = useState<string | undefined>(initialTaskId);
  const [webTask, setWebTask] = useState<string>();
  if (generation !== getAuthGeneration()) return null;
  if (showSetup)
    return (
      <CrewSetup
        crewId={crewId}
        userId={userId}
        generation={generation}
        onClose={() => setShowSetup(false)}
        onTasks={() => setShowSetup(false)}
      />
    );
  if (showAppeals)
    return (
      <TrustAppeals
        crewId={crewId}
        userId={userId}
        generation={generation}
        onClose={() => setShowAppeals(false)}
      />
    );
  if (showActivity)
    return (
      <ProjectActivity
        crewId={crewId}
        userId={userId}
        generation={generation}
        onClose={() => setShowActivity(false)}
      />
    );
  if (showDocument)
    return (
      <ProjectDocument
        crewId={crewId}
        userId={userId}
        generation={generation}
        onClose={() => setShowDocument(false)}
      />
    );
  if (showProjectProperties)
    return (
      <ProjectProperties
        crewId={crewId}
        userId={userId}
        generation={generation}
        onClose={() => setShowProjectProperties(false)}
      />
    );
  if (showResources)
    return (
      <ProjectResources
        crewId={crewId}
        userId={userId}
        generation={generation}
        onClose={() => setShowResources(false)}
      />
    );
  if (showMembers)
    return (
      <CrewMembers
        crewId={crewId}
        userId={userId}
        generation={generation}
        onClose={() => setShowMembers(false)}
        onTransferComplete={onClose}
      />
    );
  if (managingEpisodes)
    return (
      <EpisodeManagement
        crewId={crewId}
        userId={userId}
        generation={generation}
        onClose={() => setManagingEpisodes(false)}
      />
    );
  if (creatingEpisode)
    return (
      <EpisodeCreate
        crewId={crewId}
        userId={userId}
        generation={generation}
        onClose={() => setCreatingEpisode(false)}
      />
    );
  if (showTemplate)
    return (
      <EpisodeTaskTemplate
        crewId={crewId}
        userId={userId}
        generation={generation}
        onClose={() => setShowTemplate(false)}
      />
    );
  if (showProgress)
    return (
      <AssetTaskProgress
        crewId={crewId}
        generation={generation}
        onClose={() => setShowProgress(false)}
      />
    );
  if (assetOrganization)
    return (
      <AssetOrganization
        crewId={crewId}
        userId={userId}
        generation={generation}
        onClose={() => setAssetOrganization(false)}
      />
    );
  if (studioMedia)
    return (
      <StudioMedia
        crewId={crewId}
        userId={userId}
        generation={generation}
        onClose={() => setStudioMedia(false)}
      />
    );
  if (studioWorkspace)
    return (
      <CrewStudioWorkspace
        crewId={crewId}
        userId={userId}
        generation={generation}
        backLabel={initialSection === "studio" ? t("crewStudio.backToCrew") : undefined}
        onClose={() => (initialSection === "studio" ? onClose() : setStudioWorkspace(false))}
      />
    );
  if (managingWorkflows)
    return (
      <TaskWorkflowManagement
        crewId={crewId}
        userId={userId}
        generation={generation}
        onClose={() => setManagingWorkflows(false)}
      />
    );
  if (managingCycles)
    return (
      <TaskCycleManagement
        crewId={crewId}
        userId={userId}
        generation={generation}
        onClose={() => setManagingCycles(false)}
      />
    );
  if (managingLabels)
    return (
      <TaskLabelManagement
        crewId={crewId}
        userId={userId}
        generation={generation}
        onClose={() => setManagingLabels(false)}
      />
    );
  if (managingFields)
    return (
      <TaskFieldManagement
        crewId={crewId}
        userId={userId}
        generation={generation}
        onClose={() => setManagingFields(false)}
      />
    );
  if (creating)
    return (
      <TaskWorkbench
        viewId={viewId}
        crewId={crewId}
        userId={userId}
        generation={generation}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          setTaskId(id);
        }}
      />
    );
  if (webTask)
    return (
      <View style={{ flex: 1 }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setWebTask(undefined)}
          style={{ padding: 12 }}
        >
          <ThemedText>{t("taskRelations.backToTask")}</ThemedText>
        </Pressable>
        <AuthedWebView
          path={`/crews/${encodeURIComponent(crewId)}/workspace?tab=tasks&task=${encodeURIComponent(webTask)}`}
          title={t("crewTasks.title")}
        />
      </View>
    );
  if (taskId)
    return (
      <TaskDetail
        crewId={crewId}
        taskId={taskId}
        userId={userId}
        generation={generation}
        closeLabel={t("crewTasks.back")}
        onClose={() => setTaskId(undefined)}
        onOpenWeb={(id) => {
          if (generation === getAuthGeneration()) {
            setTaskId(id);
            setWebTask(id);
          }
        }}
      />
    );
  return (
    <View style={{ flex: 1 }}>
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => {
          if (generation === getAuthGeneration()) setShowSetup(true);
        }}
      >
        <ThemedText>{t("crewSetup.title")}</ThemedText>
      </Pressable>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {(["team", "community"] as const).map((channel) => (
          <Pressable
            key={channel}
            accessibilityRole="button"
            style={{ padding: 12 }}
            onPress={() => {
              if (generation === getAuthGeneration())
                router.push(toHref(`/crew-chat/${encodeURIComponent(crewId)}?channel=${channel}`));
            }}
          >
            <ThemedText>
              {t(channel === "team" ? "thread.teamChat" : "thread.communityChat")}
            </ThemedText>
          </Pressable>
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => {
          if (generation === getAuthGeneration()) setShowAppeals(true);
        }}
      >
        <ThemedText>{t("trustAppeals.queue")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => {
          if (generation === getAuthGeneration()) setShowActivity(true);
        }}
      >
        <ThemedText>{t("projectActivity.title")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => {
          if (generation === getAuthGeneration()) setShowDocument(true);
        }}
      >
        <ThemedText>{t("projectDocument.title")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => {
          if (generation === getAuthGeneration()) setShowProjectProperties(true);
        }}
      >
        <ThemedText>{t("projectProperties.title")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => {
          if (generation === getAuthGeneration()) setShowResources(true);
        }}
      >
        <ThemedText>{t("projectResources.title")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => {
          if (generation === getAuthGeneration()) setShowMembers(true);
        }}
      >
        <ThemedText>{t("crewMembers.title")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => {
          if (generation === getAuthGeneration()) setAssetOrganization(true);
        }}
      >
        <ThemedText>{t("assetOrganization.title")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => {
          if (generation === getAuthGeneration()) setStudioMedia(true);
        }}
      >
        <ThemedText>{t("studioMedia.title")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => {
          if (generation === getAuthGeneration()) setStudioWorkspace(true);
        }}
      >
        <ThemedText>{t("crewStudio.title")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          if (generation === getAuthGeneration()) setManagingWorkflows(true);
        }}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("taskWorkflowManagement.title")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          if (generation === getAuthGeneration()) setCreating(true);
        }}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("taskCreate.title")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => {
          if (generation === getAuthGeneration()) setManagingLabels(true);
        }}
      >
        <ThemedText>{t("taskLabels.title")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          if (generation === getAuthGeneration()) setManagingFields(true);
        }}
        style={{ padding: 12 }}
      >
        <ThemedText>{t("taskFields.title")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => {
          if (generation === getAuthGeneration()) setShowProgress(true);
        }}
      >
        <ThemedText>{t("assetTaskProgress.title")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => {
          if (generation === getAuthGeneration()) setShowTemplate(true);
        }}
      >
        <ThemedText>{t("episodeTaskTemplate.title")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => {
          if (generation === getAuthGeneration()) setCreatingEpisode(true);
        }}
      >
        <ThemedText>{t("episodeCreate.title")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => {
          if (generation === getAuthGeneration()) setManagingEpisodes(true);
        }}
      >
        <ThemedText>{t("episodeManagement.title")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => {
          if (generation === getAuthGeneration()) setManagingCycles(true);
        }}
      >
        <ThemedText>{t("taskCycles.title")}</ThemedText>
      </Pressable>
      <TaskViewBrowser
        userId={userId}
        crewId={crewId}
        generation={generation}
        viewId={viewId}
        onViewChange={setViewId}
        onClose={onClose}
        onSelect={(task) => {
          if (generation === getAuthGeneration()) setTaskId(task.id);
        }}
      />
    </View>
  );
}
