import * as DocumentPicker from "expo-document-picker";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";

import { fillMessageTemplate } from "../api/story-production-api";
import { getStoredString, setStoredString } from "@/lib/persistent-storage";
import { t } from "@/i18n";

import {
  agentOsApi,
  type AgentOsAttachmentSummary,
  type AgentOsPermissionMode,
  type AgentOsSkillMeta,
} from "../api/agent-os-api";
import {
  listProjectSkillInstallations,
  type ProjectSkillInstallation,
} from "../api/project-skills-api";
import type { AgentOsSendExtras } from "./use-agent-os-session";

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_TURN = 20;
const UPLOAD_CONCURRENCY = 3;
/** SecureStore rejects `:`; H5 localStorage uses `fizz:agent-os:permissionMode`. */
const PERM_STORAGE_KEY = "fizz.agent-os.permissionMode";

export type ProjectSkillComposerEntry = {
  installation: ProjectSkillInstallation;
  name: string;
  isDefault: boolean;
};

function isPermissionMode(value: string | null): value is AgentOsPermissionMode {
  return value === "ask" || value === "smart" || value === "full";
}

export function useAgentComposerTurn(projectId: string, workbenchMode: string, disabled: boolean) {
  const [pendingFiles, setPendingFiles] = useState<AgentOsAttachmentSummary[]>([]);
  const [uploading, setUploading] = useState(false);
  const [permissionMode, setPermissionModeState] = useState<AgentOsPermissionMode>("smart");
  const [invocableSkills, setInvocableSkills] = useState<AgentOsSkillMeta[]>([]);
  const [turnSkillIds, setTurnSkillIds] = useState<string[]>([]);
  const [installations, setInstallations] = useState<ProjectSkillInstallation[]>([]);
  const [projectSkillsLoading, setProjectSkillsLoading] = useState(true);
  const [projectSkillsError, setProjectSkillsError] = useState(false);
  const [skillsTick, setSkillsTick] = useState(0);
  const [turnProjectSkillIds, setTurnProjectSkillIds] = useState<string[]>([]);
  const [disabledProjectDefaultSkillIds, setDisabledProjectDefaultSkillIds] = useState<string[]>(
    []
  );

  useEffect(() => {
    void getStoredString(PERM_STORAGE_KEY)
      .then((saved) => {
        if (isPermissionMode(saved)) setPermissionModeState(saved);
      })
      .catch(() => {});
  }, []);

  const setPermissionMode = useCallback((mode: AgentOsPermissionMode) => {
    setPermissionModeState(mode);
    void setStoredString(PERM_STORAGE_KEY, mode).catch(() => {});
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void agentOsApi
      .listSkills(projectId, workbenchMode)
      .then((catalog) => {
        if (cancelled) return;
        setInvocableSkills(catalog.invocable);
        setTurnSkillIds((current) =>
          current.filter((id) => catalog.invocable.some((skill) => skill.id === id))
        );
      })
      .catch(() => {
        if (!cancelled) setInvocableSkills([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, workbenchMode]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setProjectSkillsLoading(true);
    setProjectSkillsError(false);
    void listProjectSkillInstallations("story", projectId)
      .then((payload) => {
        if (cancelled) return;
        setInstallations(payload.installations);
        setProjectSkillsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setInstallations([]);
        setProjectSkillsLoading(false);
        setProjectSkillsError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, skillsTick]);

  const projectSkillEntries = useMemo((): ProjectSkillComposerEntry[] => {
    const expectedSource = `agent_os:${workbenchMode}`;
    return installations
      .filter(
        (installation) =>
          installation.status === "active" &&
          installation.version.capabilities.includes("agent_prompt") &&
          (installation.version.workbenchModes.length === 0 ||
            installation.version.workbenchModes.includes(workbenchMode))
      )
      .map((installation) => ({
        installation,
        name:
          installation.name?.trim() || installation.slug?.trim() || t("agent.composer.skillsLabel"),
        isDefault: installation.defaults.some(
          (activation) =>
            activation.scope === "agent_prompt" &&
            (!activation.workbenchMode || activation.workbenchMode === workbenchMode) &&
            (!activation.sourceSurface || activation.sourceSurface === expectedSource)
        ),
      }));
  }, [installations, workbenchMode]);

  const availableProjectSkillIds = useMemo(
    () => new Set(projectSkillEntries.map((entry) => entry.installation.id)),
    [projectSkillEntries]
  );
  const defaultProjectSkillIds = useMemo(
    () =>
      new Set(
        projectSkillEntries.filter((entry) => entry.isDefault).map((entry) => entry.installation.id)
      ),
    [projectSkillEntries]
  );
  const effectiveTurnProjectSkillIds = turnProjectSkillIds.filter((id) =>
    availableProjectSkillIds.has(id)
  );
  const effectiveDisabledProjectDefaultSkillIds = disabledProjectDefaultSkillIds.filter((id) =>
    defaultProjectSkillIds.has(id)
  );
  const activeProjectSkillCount = projectSkillEntries.filter(({ installation, isDefault }) =>
    isDefault
      ? !effectiveDisabledProjectDefaultSkillIds.includes(installation.id)
      : effectiveTurnProjectSkillIds.includes(installation.id)
  ).length;

  const toggleTurnSkill = useCallback(
    (skillId: string) => {
      if (disabled) return;
      setTurnSkillIds((prev) =>
        prev.includes(skillId) ? prev.filter((id) => id !== skillId) : [...prev, skillId]
      );
    },
    [disabled]
  );

  const toggleProjectSkill = useCallback(
    (installationId: string, isDefault: boolean) => {
      if (disabled) return;
      if (isDefault) {
        setDisabledProjectDefaultSkillIds((current) =>
          current.includes(installationId)
            ? current.filter((id) => id !== installationId)
            : [...current, installationId]
        );
        return;
      }
      setTurnProjectSkillIds((current) =>
        current.includes(installationId)
          ? current.filter((id) => id !== installationId)
          : [...current, installationId]
      );
    },
    [disabled]
  );

  const isProjectSkillActive = useCallback(
    (installationId: string, isDefault: boolean) =>
      isDefault
        ? !effectiveDisabledProjectDefaultSkillIds.includes(installationId)
        : effectiveTurnProjectSkillIds.includes(installationId),
    [effectiveDisabledProjectDefaultSkillIds, effectiveTurnProjectSkillIds]
  );

  const removePending = useCallback((id: string) => {
    setPendingFiles((prev) => prev.filter((file) => file.id !== id));
  }, []);

  const pickAndUpload = useCallback(async () => {
    if (disabled || uploading) return;
    const remaining = Math.max(0, MAX_ATTACHMENTS_PER_TURN - pendingFiles.length);
    if (remaining === 0) {
      Alert.alert(
        t("agent.composer.attachFile"),
        fillMessageTemplate(t("agent.composer.attachmentTooMany"), {
          count: MAX_ATTACHMENTS_PER_TURN,
        })
      );
      return;
    }
    const picked = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: true,
      type: [
        "text/*",
        "application/json",
        "application/xml",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
    });
    if (picked.canceled || !picked.assets?.length) return;
    if (picked.assets.length > remaining) {
      Alert.alert(
        t("agent.composer.attachFile"),
        fillMessageTemplate(t("agent.composer.attachmentTooMany"), {
          count: MAX_ATTACHMENTS_PER_TURN,
        })
      );
    }
    const accepted = picked.assets.slice(0, remaining).flatMap((asset) => {
      const name = asset.name?.trim() || "attachment";
      const size = asset.size ?? 0;
      if (size === 0) {
        Alert.alert(
          t("agent.composer.attachFile"),
          fillMessageTemplate(t("agent.composer.attachmentEmpty"), { name })
        );
        return [];
      }
      if (size > MAX_ATTACHMENT_BYTES) {
        Alert.alert(
          t("agent.composer.attachFile"),
          fillMessageTemplate(t("agent.composer.attachmentTooLarge"), { name, size: 20 })
        );
        return [];
      }
      return [
        {
          uri: asset.uri,
          name,
          mimeType: asset.mimeType,
          size,
        },
      ];
    });
    if (accepted.length === 0) return;

    setUploading(true);
    try {
      const uploaded: AgentOsAttachmentSummary[] = [];
      for (let index = 0; index < accepted.length; index += UPLOAD_CONCURRENCY) {
        const batch = accepted.slice(index, index + UPLOAD_CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map((file) => agentOsApi.uploadAttachment(projectId, file))
        );
        results.forEach((result, batchIndex) => {
          const file = batch[batchIndex];
          if (result.status === "rejected") {
            Alert.alert(
              t("agent.composer.attachFile"),
              fillMessageTemplate(t("agent.composer.attachmentFailed"), { name: file.name })
            );
            return;
          }
          if (result.value.status !== "ready") {
            Alert.alert(
              t("agent.composer.attachFile"),
              result.value.errorMessage?.trim() ||
                fillMessageTemplate(t("agent.composer.attachmentFailed"), {
                  name: result.value.filename,
                })
            );
            return;
          }
          uploaded.push(result.value);
        });
      }
      if (uploaded.length > 0) {
        setPendingFiles((prev) => {
          const byId = new Map(prev.map((item) => [item.id, item]));
          for (const item of uploaded) byId.set(item.id, item);
          return [...byId.values()];
        });
      }
    } catch {
      Alert.alert(t("agent.composer.attachFile"), t("agent.composer.attachmentFailedGeneric"));
    } finally {
      setUploading(false);
    }
  }, [disabled, pendingFiles.length, projectId, uploading]);

  const takeSendExtras = useCallback((): AgentOsSendExtras => {
    const ready = pendingFiles.filter((file) => file.status === "ready");
    const extras: AgentOsSendExtras = {
      attachmentIds: ready.map((file) => file.id),
      attachmentNames: ready.map((file) => file.filename),
      skillIds: turnSkillIds,
      permissionMode,
      projectSkillInstallationIds:
        effectiveTurnProjectSkillIds.length > 0 ? effectiveTurnProjectSkillIds : undefined,
      disabledDefaultSkillInstallationIds:
        effectiveDisabledProjectDefaultSkillIds.length > 0
          ? effectiveDisabledProjectDefaultSkillIds
          : undefined,
    };
    setPendingFiles([]);
    setTurnSkillIds([]);
    setTurnProjectSkillIds([]);
    setDisabledProjectDefaultSkillIds([]);
    return extras;
  }, [
    effectiveDisabledProjectDefaultSkillIds,
    effectiveTurnProjectSkillIds,
    pendingFiles,
    permissionMode,
    turnSkillIds,
  ]);

  return {
    pendingFiles,
    uploading,
    permissionMode,
    setPermissionMode,
    invocableSkills,
    turnSkillIds,
    toggleTurnSkill,
    projectSkillEntries,
    projectSkillsLoading,
    projectSkillsError,
    retryProjectSkills: () => setSkillsTick((value) => value + 1),
    activeProjectSkillCount,
    toggleProjectSkill,
    isProjectSkillActive,
    pickAndUpload,
    removePending,
    canSendWithoutText: pendingFiles.some((file) => file.status === "ready"),
    takeSendExtras,
  };
}
