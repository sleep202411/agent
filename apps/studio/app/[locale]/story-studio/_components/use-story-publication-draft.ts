"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useAuth } from "@/app/_components/auth-provider";
import { ApiRequestError } from "@/lib/api";
import {
  getStoryWorkbench,
  storyApiErrorCode,
  storyApiErrorMessage,
  updateStoryProject,
  type StoryProjectSummary,
  type StoryWorkbench,
} from "@/lib/story-projects-api";
import {
  parseStoredPublicationDraft,
  migratePublicationDraft,
  migratePublicationDraftSignature,
  projectPublicationDraft,
  publicationDraftSignature,
  StoryPublicationDraftSchema,
  type StoryPublicationDraft,
} from "../_lib/story-publication-draft";
import { storyChapterWorkbenchQueryKey } from "../_lib/use-story-chapter-workbench";

export function useStoryPublicationDraft(projectId: string, workbench: StoryWorkbench) {
  const { user, isCurrentAccount } = useAuth();
  const userId = user?.id ?? null;
  const t = useTranslations("storyStudio.publication");
  const queryClient = useQueryClient();
  const scope = useMemo(() => ({ projectId, userId }), [projectId, userId]);
  const storageKey = `story-publication-draft:${userId}:${projectId}`;
  const serverValue = useMemo(
    () => projectPublicationDraft(workbench.project),
    [workbench.project]
  );
  const serverSignature = publicationDraftSignature(serverValue);
  const initial = useMemo(() => {
    const cached = typeof window === "undefined" || userId == null ? null : readDraft(storageKey);
    return {
      scope,
      edit: {
        value: cached?.value ?? serverValue,
        projectVersion: cached?.projectVersion ?? workbench.project.projectVersion,
        savedSignature: serverSignature,
      },
      saving: false,
      serverConflict: false,
      error: null as string | null,
    };
  }, [scope, serverSignature, serverValue, storageKey, userId, workbench.project.projectVersion]);
  const [record, setRecord] = useState(initial);
  const currentRecord =
    record.scope.projectId === scope.projectId && record.scope.userId === scope.userId
      ? record
      : initial;
  const { saving, error, serverConflict } = currentRecord;
  const edit = {
    ...currentRecord.edit,
    value: migratePublicationDraft(currentRecord.edit.value),
    savedSignature: migratePublicationDraftSignature(currentRecord.edit.savedSignature),
  };
  const updateRecord = useCallback(
    (change: (current: typeof initial) => typeof initial) => {
      setRecord((current) =>
        change(
          current.scope.projectId === scope.projectId && current.scope.userId === scope.userId
            ? current
            : initial
        )
      );
    },
    [initial, scope]
  );
  const dirty = publicationDraftSignature(edit.value) !== edit.savedSignature;
  const conflicted =
    serverConflict || (dirty && edit.projectVersion !== workbench.project.projectVersion);
  const canEdit = workbench.project.capabilities.includes("story.edit");
  const valid = StoryPublicationDraftSchema.safeParse(edit.value).success;
  const latest = useRef({ edit, workbench, dirty, serverConflict });
  latest.current = { edit, workbench, dirty, serverConflict };
  const owner = useRef<{
    controller: AbortController;
    pending: Promise<StoryWorkbench> | null;
    snapshot: Promise<StoryWorkbench> | null;
    refresh: Promise<StoryWorkbench> | null;
    busy: number;
  } | null>(null);
  useLayoutEffect(() => {
    const next = {
      controller: new AbortController(),
      pending: null,
      snapshot: null,
      refresh: null,
      busy: 0,
    };
    owner.current = next;
    return () => {
      next.controller.abort();
      if (owner.current === next) owner.current = null;
    };
  }, [scope]);

  useEffect(() => {
    if (dirty || saving || workbench.project.projectVersion < edit.projectVersion) return;
    if (
      edit.projectVersion !== workbench.project.projectVersion ||
      edit.savedSignature !== serverSignature
    ) {
      updateRecord((current) => ({
        ...current,
        serverConflict: false,
        edit: {
          value: serverValue,
          projectVersion: workbench.project.projectVersion,
          savedSignature: serverSignature,
        },
      }));
    }
  }, [
    dirty,
    edit.projectVersion,
    edit.savedSignature,
    saving,
    serverSignature,
    serverValue,
    updateRecord,
    workbench.project.projectVersion,
  ]);

  useEffect(() => {
    if (userId == null) return;
    try {
      if (dirty)
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({ value: edit.value, projectVersion: edit.projectVersion })
        );
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* A server save remains available if browser storage is unavailable. */
    }
  }, [dirty, edit.value, edit.projectVersion, storageKey, userId]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const update = useCallback(
    (value: StoryPublicationDraft) => {
      if (!canEdit || owner.current?.busy) return;
      updateRecord((current) => ({
        ...current,
        error: null,
        edit: { ...current.edit, value: migratePublicationDraft(value) },
      }));
    },
    [canEdit, updateRecord]
  );

  const updateCachedProject = useCallback(
    (project: StoryProjectSummary) => {
      queryClient.setQueriesData<StoryWorkbench>(
        {
          predicate: (query) =>
            query.queryKey[0] === "story-studio" &&
            query.queryKey[2] === projectId &&
            query.queryKey.at(-1) === userId &&
            ["workbench", "chapter-workbench", "script-workbench"].includes(
              String(query.queryKey[1])
            ),
        },
        (cached) =>
          cached?.project && cached.project.projectVersion <= project.projectVersion
            ? { ...cached, project }
            : cached
      );
      void queryClient.invalidateQueries({ queryKey: ["story-studio", "projects"] });
    },
    [projectId, queryClient, userId]
  );

  const save = useCallback(async (): Promise<StoryWorkbench> => {
    const currentOwner = owner.current;
    if (
      !currentOwner ||
      currentOwner.controller.signal.aborted ||
      userId == null ||
      !isCurrentAccount(userId)
    ) {
      throw abandoned();
    }
    if (currentOwner.pending) return currentOwner.pending;
    const current = latest.current;
    if (current.serverConflict) {
      updateRecord((record) => ({ ...record, error: t("conflict") }));
      throw new Error(t("conflict"));
    }
    if (!current.dirty) return current.workbench;
    if (!current.workbench.project.capabilities.includes("story.edit"))
      throw new Error(t("editDenied"));
    const parsed = StoryPublicationDraftSchema.safeParse(current.edit.value);
    if (!parsed.success) throw new Error(t("invalidDraft"));
    if (current.edit.projectVersion !== current.workbench.project.projectVersion) {
      updateRecord((record) => ({ ...record, error: t("conflict") }));
      throw new Error(t("conflict"));
    }
    const isActive = () =>
      owner.current === currentOwner &&
      !currentOwner.controller.signal.aborted &&
      isCurrentAccount(userId);
    currentOwner.busy += 1;
    updateRecord((record) => ({ ...record, saving: true, error: null }));
    const pending = (async () => {
      try {
        const project = await updateStoryProject(
          projectId,
          {
            expectedProjectVersion: current.edit.projectVersion,
            storeListing: parsed.data.listing,
            ...(parsed.data.coverAssetId !== (current.workbench.project.cover?.id ?? null)
              ? { coverAssetId: parsed.data.coverAssetId }
              : {}),
          },
          currentOwner.controller.signal
        );
        if (!isActive()) throw abandoned();
        if (project.id !== projectId || project.projectVersion <= current.edit.projectVersion)
          throw new Error(t("saveFailed"));
        const next = { ...current.workbench, project };
        const savedValue = projectPublicationDraft(project);
        updateRecord((record) => ({
          ...record,
          serverConflict: false,
          edit: {
            value: savedValue,
            projectVersion: project.projectVersion,
            savedSignature: publicationDraftSignature(savedValue),
          },
        }));
        updateCachedProject(project);
        return next;
      } catch (failure) {
        if (isActive())
          updateRecord((record) => ({
            ...record,
            serverConflict: record.serverConflict || isPatchVersionConflict(failure),
            error: storyApiErrorMessage(failure, t("saveFailed")),
          }));
        throw failure;
      } finally {
        currentOwner.pending = null;
        currentOwner.busy -= 1;
        if (isActive()) updateRecord((record) => ({ ...record, saving: currentOwner.busy > 0 }));
      }
    })();
    currentOwner.pending = pending;
    return pending;
  }, [isCurrentAccount, projectId, t, updateCachedProject, updateRecord, userId]);

  const readLatest = useCallback(
    async (
      source: StoryWorkbench,
      currentOwner: NonNullable<typeof owner.current>
    ): Promise<StoryWorkbench> => {
      if (userId == null || !isCurrentAccount(userId)) throw abandoned();
      const fresh = await getStoryWorkbench(
        projectId,
        source.chapter.id,
        currentOwner.controller.signal
      );
      if (
        owner.current !== currentOwner ||
        currentOwner.controller.signal.aborted ||
        !isCurrentAccount(userId)
      )
        throw abandoned();
      if (
        fresh.project.id !== projectId ||
        fresh.chapter.id !== source.chapter.id ||
        fresh.project.projectVersion <
          Math.max(source.project.projectVersion, latest.current.edit.projectVersion)
      )
        throw new Error(t("saveFailed"));
      queryClient.setQueryData(
        storyChapterWorkbenchQueryKey(projectId, fresh.chapter.id, userId),
        fresh
      );
      updateCachedProject(fresh.project);
      return fresh;
    },
    [isCurrentAccount, projectId, queryClient, t, updateCachedProject, userId]
  );

  const prepareSnapshot = useCallback(async (): Promise<StoryWorkbench> => {
    const currentOwner = owner.current;
    if (
      !currentOwner ||
      currentOwner.controller.signal.aborted ||
      userId == null ||
      !isCurrentAccount(userId)
    )
      throw abandoned();
    if (currentOwner.snapshot) return currentOwner.snapshot;
    currentOwner.busy += 1;
    updateRecord((record) => ({ ...record, saving: true, error: null }));
    const pending = (async () => {
      try {
        return await readLatest(await save(), currentOwner);
      } catch (failure) {
        if (
          owner.current === currentOwner &&
          !currentOwner.controller.signal.aborted &&
          isCurrentAccount(userId)
        )
          updateRecord((record) => ({
            ...record,
            error: storyApiErrorMessage(failure, t("saveFailed")),
          }));
        throw failure;
      } finally {
        currentOwner.snapshot = null;
        currentOwner.busy -= 1;
        if (
          owner.current === currentOwner &&
          !currentOwner.controller.signal.aborted &&
          isCurrentAccount(userId)
        )
          updateRecord((record) => ({ ...record, saving: currentOwner.busy > 0 }));
      }
    })();
    currentOwner.snapshot = pending;
    return pending;
  }, [isCurrentAccount, readLatest, save, t, updateRecord, userId]);

  const refreshAndKeepDraft = useCallback(async (): Promise<StoryWorkbench> => {
    const currentOwner = owner.current;
    if (
      !currentOwner ||
      currentOwner.controller.signal.aborted ||
      userId == null ||
      !isCurrentAccount(userId)
    )
      throw abandoned();
    if (currentOwner.refresh) return currentOwner.refresh;
    if (currentOwner.busy) throw abandoned();
    currentOwner.busy += 1;
    updateRecord((record) => ({ ...record, saving: true, error: null }));
    const pending = (async () => {
      try {
        const fresh = await readLatest(latest.current.workbench, currentOwner);
        updateRecord((record) => ({
          ...record,
          serverConflict: false,
          edit: {
            ...record.edit,
            projectVersion: fresh.project.projectVersion,
            savedSignature: publicationDraftSignature(projectPublicationDraft(fresh.project)),
          },
        }));
        return fresh;
      } catch (failure) {
        if (
          owner.current === currentOwner &&
          !currentOwner.controller.signal.aborted &&
          isCurrentAccount(userId)
        )
          updateRecord((record) => ({
            ...record,
            error: storyApiErrorMessage(failure, t("saveFailed")),
          }));
        throw failure;
      } finally {
        currentOwner.refresh = null;
        currentOwner.busy -= 1;
        if (
          owner.current === currentOwner &&
          !currentOwner.controller.signal.aborted &&
          isCurrentAccount(userId)
        )
          updateRecord((record) => ({ ...record, saving: currentOwner.busy > 0 }));
      }
    })();
    currentOwner.refresh = pending;
    return pending;
  }, [isCurrentAccount, readLatest, t, updateRecord, userId]);

  return {
    value: edit.value,
    update,
    save,
    prepareSnapshot,
    refreshAndKeepDraft,
    dirty,
    saving,
    error,
    valid,
    conflicted,
    canEdit,
  };
}

function readDraft(storageKey: string) {
  try {
    return parseStoredPublicationDraft(sessionStorage.getItem(storageKey));
  } catch {
    return null;
  }
}
function abandoned() {
  return new DOMException("Publication draft abandoned", "AbortError");
}

function isPatchVersionConflict(failure: unknown): boolean {
  return (
    (failure instanceof ApiRequestError && failure.status === 409) ||
    storyApiErrorCode(failure) === "STORY_PROJECT_VERSION_CONFLICT"
  );
}
