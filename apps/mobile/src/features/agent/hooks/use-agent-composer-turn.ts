import * as DocumentPicker from "expo-document-picker";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { useStoryRequestScope } from "./use-story-request-scope";
import type { AgentOsSendExtras } from "./use-agent-os-session";

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_TURN = 20;
const UPLOAD_CONCURRENCY = 3;
/** Composer attachments are plain text only. The iOS picker type list is a
 * hint, not a lock — reject anything else after pick. */
const ATTACHMENT_PICKER_TYPES = ["text/plain", "text/markdown", "text/x-markdown"];
const ATTACHMENT_ALLOWED_EXT = /\.(txt|md)$/i;
/** SecureStore rejects `:`; H5 localStorage uses `fizz:agent-os:permissionMode`. */
const PERM_STORAGE_KEY = "fizz.agent-os.permissionMode";

function isAllowedComposerAttachment(name: string): boolean {
  return ATTACHMENT_ALLOWED_EXT.test(name.trim());
}

export type ProjectSkillComposerEntry = {
  installation: ProjectSkillInstallation;
  name: string;
  isDefault: boolean;
};

function isPermissionMode(value: string | null): value is AgentOsPermissionMode {
  return value === "ask" || value === "smart" || value === "full";
}

export function useAgentComposerTurn(
  projectId: string,
  workbenchMode: string,
  disabled: boolean,
  chapterId?: string
) {
  const scope = useStoryRequestScope(JSON.stringify([projectId, workbenchMode, chapterId]));
  const scopeRef = useRef<typeof scope | null>(scope);
  const disabledRef = useRef(disabled);
  const uploadRef = useRef<AbortController | null>(null);
  const preferenceVersion = useRef(0);
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

  const [previousScope, setPreviousScope] = useState(scope);
  if (previousScope !== scope) {
    setPreviousScope(scope);
    setPendingFiles([]);
    setUploading(false);
    setInvocableSkills([]);
    setInstallations([]);
    setTurnSkillIds([]);
    setTurnProjectSkillIds([]);
    setDisabledProjectDefaultSkillIds([]);
    setProjectSkillsLoading(Boolean(projectId) && scope.enabled);
    setProjectSkillsError(false);
  }
  useLayoutEffect(() => {
    scopeRef.current = scope;
    return () => {
      scopeRef.current = null;
      uploadRef.current?.abort();
      uploadRef.current = null;
    };
  }, [scope]);
  const [previousDisabled, setPreviousDisabled] = useState(disabled);
  if (previousDisabled !== disabled) {
    setPreviousDisabled(disabled);
    if (disabled) setUploading(false);
  }
  useLayoutEffect(() => {
    disabledRef.current = disabled;
    if (disabled) {
      uploadRef.current?.abort();
      uploadRef.current = null;
    }
  }, [disabled]);
  const canEdit = useCallback(
    () => scopeRef.current === scope && scope.enabled && !disabledRef.current,
    [scope]
  );

  useEffect(() => {
    let cancelled = false;
    const version = preferenceVersion.current;
    void getStoredString(PERM_STORAGE_KEY)
      .then((saved) => {
        if (!cancelled && preferenceVersion.current === version && isPermissionMode(saved))
          setPermissionModeState(saved);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const setPermissionMode = useCallback(
    (mode: AgentOsPermissionMode) => {
      if (!canEdit()) return;
      preferenceVersion.current += 1;
      setPermissionModeState(mode);
      void setStoredString(PERM_STORAGE_KEY, mode).catch(() => {});
    },
    [canEdit]
  );

  useEffect(() => {
    if (!projectId || !scope.enabled) return;
    const request = new AbortController();
    void agentOsApi
      .listSkills(projectId, workbenchMode, request.signal)
      .then((catalog) => {
        if (request.signal.aborted) return;
        setInvocableSkills(catalog.invocable);
        setTurnSkillIds((current) =>
          current.filter((id) => catalog.invocable.some((skill) => skill.id === id))
        );
      })
      .catch(() => {
        if (!request.signal.aborted) setInvocableSkills([]);
      });
    return () => request.abort();
  }, [projectId, workbenchMode, scope]);

  const skillsKey = `${projectId}:${skillsTick}`;
  const [previousSkillsKey, setPreviousSkillsKey] = useState(skillsKey);
  if (previousSkillsKey !== skillsKey) {
    setPreviousSkillsKey(skillsKey);
    setProjectSkillsLoading(Boolean(projectId) && scope.enabled);
    setProjectSkillsError(false);
  }

  useEffect(() => {
    if (!projectId || !scope.enabled) return;
    const request = new AbortController();
    void listProjectSkillInstallations("story", projectId, request.signal)
      .then((payload) => {
        if (request.signal.aborted) return;
        setInstallations(payload.installations);
        setProjectSkillsLoading(false);
      })
      .catch(() => {
        if (request.signal.aborted) return;
        setProjectSkillsLoading(false);
        setProjectSkillsError(true);
      });
    return () => request.abort();
  }, [projectId, skillsTick, scope]);

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
      if (!canEdit()) return;
      setTurnSkillIds((prev) =>
        prev.includes(skillId) ? prev.filter((id) => id !== skillId) : [...prev, skillId]
      );
    },
    [canEdit]
  );

  const toggleProjectSkill = useCallback(
    (installationId: string, isDefault: boolean) => {
      if (!canEdit()) return;
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
    [canEdit]
  );

  const isProjectSkillActive = useCallback(
    (installationId: string, isDefault: boolean) =>
      isDefault
        ? !effectiveDisabledProjectDefaultSkillIds.includes(installationId)
        : effectiveTurnProjectSkillIds.includes(installationId),
    [effectiveDisabledProjectDefaultSkillIds, effectiveTurnProjectSkillIds]
  );

  const removePending = useCallback(
    (id: string) => {
      if (!canEdit()) return;
      setPendingFiles((prev) => prev.filter((file) => file.id !== id));
    },
    [canEdit]
  );

  const pickAndUpload = useCallback(async () => {
    if (!canEdit() || uploadRef.current) return;
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
    const operation = new AbortController();
    uploadRef.current = operation;
    setUploading(true);
    const isCurrent = () =>
      canEdit() && uploadRef.current === operation && !operation.signal.aborted;
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true,
        type: ATTACHMENT_PICKER_TYPES,
      });
      if (!isCurrent()) return;
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
        if (!isAllowedComposerAttachment(name)) {
          Alert.alert(
            t("agent.composer.attachFile"),
            fillMessageTemplate(t("agent.composer.attachmentUnsupportedType"), { name })
          );
          return [];
        }
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

      const uploaded: AgentOsAttachmentSummary[] = [];
      for (let index = 0; index < accepted.length; index += UPLOAD_CONCURRENCY) {
        if (!isCurrent()) return;
        const batch = accepted.slice(index, index + UPLOAD_CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map((file) => agentOsApi.uploadAttachment(projectId, file, operation.signal))
        );
        if (!isCurrent()) return;
        results.forEach((result, batchIndex) => {
          const file = batch[batchIndex];
          if (result.status === "rejected") {
            Alert.alert(
              t("agent.composer.attachFile"),
              result.reason instanceof Error
                ? result.reason.message
                : fillMessageTemplate(t("agent.composer.attachmentFailed"), { name: file.name })
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
    } catch (error) {
      if (isCurrent())
        Alert.alert(
          t("agent.composer.attachFile"),
          error instanceof Error ? error.message : t("agent.composer.attachmentFailedGeneric")
        );
    } finally {
      if (uploadRef.current === operation) {
        uploadRef.current = null;
        setUploading(false);
      }
    }
  }, [canEdit, pendingFiles.length, projectId]);

  const getSendExtras = useCallback((): AgentOsSendExtras | undefined => {
    if (!canEdit() || uploadRef.current) return undefined;
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
    return extras;
  }, [
    canEdit,
    effectiveDisabledProjectDefaultSkillIds,
    effectiveTurnProjectSkillIds,
    pendingFiles,
    permissionMode,
    turnSkillIds,
  ]);

  const commitSendExtras = useCallback(
    (extras: AgentOsSendExtras) => {
      // Sending itself locks editing; successful consumption needs scope ownership,
      // not the now-disabled editor flag.
      if (scopeRef.current !== scope || !scope.enabled) return;
      setPendingFiles((files) => files.filter((file) => !extras.attachmentIds?.includes(file.id)));
      setTurnSkillIds((ids) => ids.filter((id) => !extras.skillIds?.includes(id)));
      setTurnProjectSkillIds((ids) =>
        ids.filter((id) => !extras.projectSkillInstallationIds?.includes(id))
      );
      setDisabledProjectDefaultSkillIds((ids) =>
        ids.filter((id) => !extras.disabledDefaultSkillInstallationIds?.includes(id))
      );
    },
    [scope]
  );

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
    retryProjectSkills: () => {
      if (canEdit()) setSkillsTick((value) => value + 1);
    },
    activeProjectSkillCount,
    toggleProjectSkill,
    isProjectSkillActive,
    pickAndUpload,
    removePending,
    canSendWithoutText: pendingFiles.some((file) => file.status === "ready"),
    getSendExtras,
    commitSendExtras,
  };
}
