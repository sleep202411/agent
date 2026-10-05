"use client";

/**
 * Create-crew dialog. Phase-1 spec entry — opens from the `/crews`
 * hero CTA. Visually mirrors `<CreateIPDialog>` so the two creation
 * flows feel like one product (see `DESIGN.md` § "Create dialog
 * conventions" for the full pattern).
 *
 * Fields (matching `POST /project/crew/create`):
 *   - 名称 / name         — required
 *   - 描述 / description  — required
 *   - logo               — required, square image upload (cropped to
 *                          circle in every consuming surface)
 *
 * The older `cover` / `coverVideo` fields were dropped in the
 * `crew_logo_and_showcase` migration — hero visuals on the detail
 * page now come from `showcaseWorks[0]` (or an enlarged-logo
 * gradient fallback). Tagline / genres / styles / socialLinks /
 * showcaseWorks are edited in the workspace 基本信息 tab (Phase B).
 */

import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconLoader2, IconPhoto } from "@tabler/icons-react";
import { toast } from "sonner";
import posthog from "posthog-js";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHero,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { useCurrentUser } from "@/src/hooks/use-user";
import { uploadBanner } from "@/src/services/user";
import { env } from "@/src/env";
import { cn } from "@/lib/utils";
import {
  crewApi,
  CrewApiError,
  useCreateCrew,
  useUpdateCrew,
} from "@/app/(site)/crews/_hooks/use-crew";
import { CrewEligibilityNotice } from "./crew-eligibility-notice";

// Hero image — same static CDN we use for `<CreateIPDialog>`. Replace
// when product gives a crew-specific illustration.
const CREATE_CREW_HERO_URL = encodeURI(
  "https://static.fizzspace.cn/static/pc/ChatGPT Image 2026年4月28日 20_51_09.png"
);

const DEFAULT_CREW_LOGO_URL = "https://static.fizzspace.cn/static/pc/crew_icon_default.png";

/**
 * `initial` is the gate for edit mode. When present, dialog prefills
 * from it on open and routes submit through `updateCrew` instead of
 * `createCrew`. Absent → original create flow, unchanged.
 */
export interface CrewFormInitial {
  id: string;
  name: string;
  description?: string;
  /** OSS path of the crew logo (square). */
  logo?: string;
}

interface CreateCrewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: CrewFormInitial | null;
  onCreated?: (crew: { id: string }) => void;
}

export function CreateCrewDialog(props: CreateCrewDialogProps) {
  const { user, isLoading } = useCurrentUser();
  return (
    <CrewDialogSession
      key={user?.id ?? "anonymous"}
      {...props}
      accountId={user?.id ?? null}
      accountLoading={isLoading}
    />
  );
}

function CrewDialogSession(
  props: CreateCrewDialogProps & { accountId: string | null; accountLoading: boolean }
) {
  const t = useTranslations("crew.creationRequirements");
  const eligibility = useQuery({
    queryKey: ["crew-creation-eligibility", props.accountId],
    queryFn: () =>
      crewApi.get<{
        eligible: boolean;
        workspaces?: Array<{ id: string; name: string }>;
      }>("/crews/creation-eligibility"),
    enabled: props.open && !props.initial && !props.accountLoading,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  if (!props.open) return null;
  if (props.initial) return <CrewFormDialog key={props.initial.id} {...props} />;
  if (eligibility.isPending || eligibility.isFetching || eligibility.isError) {
    return (
      <Dialog open={props.open} onOpenChange={props.onOpenChange}>
        <DialogContent>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {eligibility.isError ? eligibility.error.message : t("checking")}
          </DialogDescription>
          {eligibility.isError && (
            <Button onClick={() => void eligibility.refetch()}>{t("retry")}</Button>
          )}
        </DialogContent>
      </Dialog>
    );
  }
  if (eligibility.data?.eligible !== true)
    return <CrewEligibilityNotice open={props.open} onOpenChange={props.onOpenChange} />;
  return (
    <CrewFormDialog
      {...props}
      workspaces={eligibility.data.workspaces ?? []}
      onCertificationRequired={() => void eligibility.refetch()}
    />
  );
}

function CrewFormDialog({
  open,
  onOpenChange,
  initial,
  accountId,
  workspaces = [],
  onCertificationRequired,
  onCreated,
}: CreateCrewDialogProps & {
  accountId?: string | null;
  workspaces?: Array<{ id: string; name: string }>;
  onCertificationRequired?: () => void;
}) {
  const t = useTranslations("crew");
  const tc = useTranslations("common");
  const router = useRouter();
  const locale = useLocale() as Locale;

  const isEdit = !!initial;
  const [requirementsOpen, setRequirementsOpen] = useState(false);

  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  // Backend persists a relative OSS key in `logo`; we keep both the
  // raw key (sent on submit) and rely on env.BANNER_BASE_URL to render
  // the local preview.
  const [logoPath, setLogoPath] = useState(initial?.logo ?? "");
  const [productionKind, setProductionKind] = useState<"interactive_film" | "series">("series");
  const [workspaceMode, setWorkspaceMode] = useState<"link" | "create">(
    workspaces.length > 0 ? "link" : "create"
  );
  const [studioWorkspaceId, setStudioWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [selectedStoryProjectId, setSelectedStoryProjectId] = useState<string>("");
  const [plotTreeData, setPlotTreeData] = useState<{
    plotTree: Record<string, unknown> & { nodes: unknown[] };
    storyboardClipsByNode?: Record<
      string,
      Array<{ clipId: string; title: string; order: number; durationSeconds: number | null }>
    >;
  } | null>(null);
  const [plotTreeLoading, setPlotTreeLoading] = useState(false);
  const [plotTreeIssues, setPlotTreeIssues] = useState<Array<{
    nodeId?: string;
    kind: string;
    message: string;
  }> | null>(null);

  const storyProjectsQuery = useQuery({
    queryKey: ["story-projects-list-picker", accountId ?? null],
    queryFn: () => crewApi.get<{ items: Array<{ id: string; title: string }> }>("/story-projects"),
    enabled: open && !isEdit && productionKind === "interactive_film",
    staleTime: 60_000,
  });

  const handleStoryProjectSelect = async (projectId: string) => {
    setSelectedStoryProjectId(projectId);
    setPlotTreeData(null);
    setPlotTreeIssues(null);
    if (!projectId) return;

    setPlotTreeLoading(true);
    try {
      const res = await crewApi.get<{
        projectId: string;
        title: string;
        plotTree: Record<string, unknown> & { nodes: unknown[] };
        storyboardClipsByNode?: Record<
          string,
          Array<{ clipId: string; title: string; order: number; durationSeconds: number | null }>
        >;
      }>(`/story-projects/${encodeURIComponent(projectId)}/plot-tree`);
      setPlotTreeData({
        plotTree: res.plotTree,
        storyboardClipsByNode: res.storyboardClipsByNode,
      });
    } catch (err) {
      if (!alive.current) return;
      if (
        err instanceof CrewApiError &&
        err.status === 422 &&
        typeof err.body === "object" &&
        err.body
      ) {
        const b = err.body as {
          issues?: Array<{ nodeId?: string; kind: string; message: string }>;
        };
        setPlotTreeIssues(b.issues ?? [{ kind: "error", message: err.message }]);
      } else {
        setPlotTreeIssues([
          { kind: "error", message: err instanceof Error ? err.message : String(err) },
        ]);
      }
    } finally {
      if (alive.current) setPlotTreeLoading(false);
    }
  };
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const create = useCreateCrew();
  const update = useUpdateCrew();
  // Kept named `creating` in body so the existing JSX still reads
  // naturally — in edit mode this just means "update in flight".
  const [creating, setCreating] = useState(false);
  const alive = useRef(false);
  const operation = useRef<"save" | "upload" | null>(null);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const finishSave = () => {
    if (!alive.current) return;
    operation.current = null;
    setCreating(false);
  };

  // ─── Logo upload (image) ──────────────────────────
  const handleLogoFile = async (file: File) => {
    if (!alive.current || operation.current) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("createLogoImageOnly"));
      return;
    }
    operation.current = "upload";
    setUploadingLogo(true);
    try {
      const path = await uploadBanner(file);
      if (!alive.current) return;
      if (typeof path !== "string" || path.length === 0) {
        throw new Error("upload returned empty path");
      }
      setLogoPath(path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (alive.current) toast.error(msg || t("createLogoUploadFailed"));
    } finally {
      if (alive.current) {
        operation.current = null;
        setUploadingLogo(false);
      }
    }
  };

  // Shared error handler — both flows surface the raw backend response
  // so a hidden 401 / 422 isn't masked behind a generic toast (platform
  // error convention — see DESIGN.md § "Error toasts").
  const reportError = (err: unknown, fallbackKey: "createFailed" | "updateFailed") => {
    if (err instanceof CrewApiError) {
      const body =
        typeof err.body === "object" && err.body && "message" in err.body
          ? String((err.body as { message: unknown }).message)
          : typeof err.body === "string"
            ? err.body.slice(0, 800)
            : err.message;
      toast.error(`HTTP ${err.status}`, { description: body, duration: 10000 });
    } else {
      const msg = err instanceof Error ? err.message : "";
      toast.error(msg || t(fallbackKey));
    }
  };

  // ─── Submit ─────────────────────────────────────────
  const handleSubmit = () => {
    if (!alive.current || operation.current || !name.trim() || !description.trim()) return;
    if (
      !isEdit &&
      ((workspaceMode === "link" && !studioWorkspaceId) ||
        (workspaceMode === "create" && !newWorkspaceName.trim() && !name.trim()))
    )
      return;
    operation.current = "save";
    setCreating(true);

    // Empty logo falls back to the platform crew default so the backend
    // (which requires a non-empty string) accepts the payload.
    const resolvedLogo = logoPath.trim() || DEFAULT_CREW_LOGO_URL;

    if (isEdit && initial) {
      update.mutate(
        {
          id: String(initial.id),
          name: name.trim(),
          logo: resolvedLogo,
          description: description.trim(),
        },
        {
          onSuccess: () => {
            if (!alive.current) return;
            onOpenChange(false);
            toast.success(t("updateSuccess"));
          },
          onError: (err) => {
            if (alive.current) reportError(err, "updateFailed");
          },
          onSettled: finishSave,
        }
      );
      return;
    }

    create.mutate(
      {
        name: name.trim(),
        logo: resolvedLogo,
        description: description.trim(),
        productionTemplateLocale: locale,
        productionKind,
        ...(workspaceMode === "create"
          ? { createStudioWorkspace: { name: newWorkspaceName.trim() || name.trim() } }
          : { studioWorkspaceId }),
        ...(productionKind === "interactive_film" && plotTreeData
          ? {
              plotTree: plotTreeData.plotTree,
              storyboardClipsByNode: plotTreeData.storyboardClipsByNode,
            }
          : {}),
      },
      {
        onSuccess: (crew) => {
          if (!alive.current) return;
          posthog.capture("crew_created", { crew_id: crew.id });
          onOpenChange(false);
          toast.success(t("createSuccess"));
          if (onCreated) onCreated(crew);
          else router.push(localizePath(`/crews/${crew.id}/setup`, locale));
        },
        onError: (err) => {
          if (!alive.current) return;
          if (
            err instanceof CrewApiError &&
            err.status === 403 &&
            ((err.body as { code?: string } | null)?.code === "CREW_LEVEL_REQUIRED" ||
              (err.body as { code?: string } | null)?.code ===
                "CREW_PRODUCER_CERTIFICATION_REQUIRED")
          ) {
            onCertificationRequired?.();
            return;
          }
          posthog.captureException(err);
          reportError(err, "createFailed");
        },
        onSettled: finishSave,
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
        <DialogHero
          src={CREATE_CREW_HERO_URL}
          eyebrow={t("createDialogEyebrow")}
          title={isEdit ? t("editDialogTitle") : t("createDialogTitle")}
          description={isEdit ? t("editDialogSubtitle") : t("createDialogSubtitle")}
        />

        <DialogBody>
          {!isEdit && (
            <>
              <button
                type="button"
                className="mb-4 text-sm underline underline-offset-4 focus-visible:outline focus-visible:outline-2"
                onClick={() => setRequirementsOpen(true)}
              >
                {t("creationRequirements.title")}
              </button>
              <CrewEligibilityNotice
                open={open && requirementsOpen}
                onOpenChange={setRequirementsOpen}
              />
            </>
          )}
          <FieldGroup>
            {/* Logo first, centered, no label — it IS the identity
                anchor of the form. Avatar-style picker matches the
                pattern users have seen on profile setup screens. */}
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                disabled={uploadingLogo || creating}
                className={cn(
                  "relative flex size-28 items-center justify-center overflow-hidden rounded-full border border-dashed border-border bg-muted/30 transition-colors hover:border-primary/50",
                  uploadingLogo && "cursor-wait opacity-60"
                )}
                aria-label={t("createLogoLabel")}
              >
                {logoPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={
                      logoPath.startsWith("http") ? logoPath : `${env.BANNER_BASE_URL}/${logoPath}`
                    }
                    alt=""
                    className="size-full object-cover"
                  />
                ) : uploadingLogo ? (
                  <IconLoader2 className="size-7 animate-spin text-muted-foreground" />
                ) : (
                  <IconPhoto className="size-7 text-muted-foreground" />
                )}
              </button>
              <p className="max-w-xs text-center text-[11px] text-muted-foreground">
                {t("createLogoHelp")}
                <span className="font-semibold text-destructive"> *</span>
              </p>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void handleLogoFile(file);
                }}
              />
            </div>

            <Field>
              <FieldLabel required>{t("createNameLabel")}</FieldLabel>
              <Input
                disabled={creating}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("createNamePlaceholder")}
                maxLength={60}
              />
            </Field>

            <Field>
              <FieldLabel required>{t("createDescriptionLabel")}</FieldLabel>
              <Textarea
                // Cap height so a long description doesn't push the
                // submit button out of the dialog. Auto-grow stops at
                // max-h and the textarea's own scrollbar takes over.
                className="max-h-40 overflow-y-auto"
                disabled={creating}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("createDescriptionPlaceholder")}
                maxLength={500}
                rows={3}
              />
            </Field>

            {!isEdit ? (
              <>
                <Field>
                  <FieldLabel required>{t("createProductionKindLabel")}</FieldLabel>
                  <NativeSelect
                    aria-label={t("createProductionKindLabel")}
                    disabled={creating}
                    value={productionKind}
                    onChange={(value) => {
                      const nextKind = value as "interactive_film" | "series";
                      setProductionKind(nextKind);
                      if (nextKind !== "interactive_film") {
                        setSelectedStoryProjectId("");
                        setPlotTreeData(null);
                        setPlotTreeIssues(null);
                      }
                    }}
                    className="h-9 w-full"
                  >
                    <option value="series">{t("createProductionKindSeries")}</option>
                    <option value="interactive_film">{t("createProductionKindFilm")}</option>
                  </NativeSelect>
                </Field>

                {productionKind === "interactive_film" ? (
                  <Field>
                    <FieldLabel>{t("importFromCanvas")}</FieldLabel>
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <NativeSelect
                          aria-label={t("importFromCanvas")}
                          disabled={creating || plotTreeLoading}
                          value={selectedStoryProjectId}
                          onChange={(val) => void handleStoryProjectSelect(val)}
                          className="h-9 w-full"
                        >
                          <option value="">{t("importEmpty")}</option>
                          {(storyProjectsQuery.data?.items ?? []).map((proj) => (
                            <option key={proj.id} value={proj.id}>
                              {proj.title}
                            </option>
                          ))}
                        </NativeSelect>
                        {selectedStoryProjectId ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={creating || plotTreeLoading}
                            onClick={() => void handleStoryProjectSelect("")}
                          >
                            {t("importClearSelection")}
                          </Button>
                        ) : null}
                      </div>

                      {plotTreeLoading ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <IconLoader2 className="size-3 animate-spin" />
                          <span>{t("importLoading")}</span>
                        </div>
                      ) : null}

                      {plotTreeData ? (
                        <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400">
                          {t("importSummary", {
                            nodes: plotTreeData.plotTree?.nodes?.length ?? 0,
                            shots: Object.values(plotTreeData.storyboardClipsByNode ?? {}).reduce(
                              (sum, list) => sum + list.length,
                              0
                            ),
                          })}
                        </div>
                      ) : null}

                      {plotTreeIssues && plotTreeIssues.length > 0 ? (
                        <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                          <p className="font-medium mb-1">{t("importIssuesTitle")}</p>
                          <ul className="list-disc pl-4 space-y-0.5 max-h-32 overflow-y-auto">
                            {plotTreeIssues.map((issue, idx) => (
                              <li key={idx}>
                                {issue.nodeId ? `[${issue.nodeId}] ` : ""}
                                {issue.message}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  </Field>
                ) : null}
                <Field>
                  <FieldLabel required>{t("createWorkspaceLabel")}</FieldLabel>
                  <p className="mb-2 text-[11px] text-muted-foreground">
                    {t("createWorkspaceHelp")}
                  </p>
                  <div className="flex flex-col gap-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="workspace-mode"
                        className="accent-[#E52227]"
                        disabled={creating}
                        checked={workspaceMode === "link"}
                        onChange={() => setWorkspaceMode("link")}
                      />
                      {t("createWorkspaceLink")}
                    </label>
                    {workspaceMode === "link" ? (
                      workspaces.length === 0 ? (
                        <p className="text-xs text-muted-foreground">{t("createWorkspaceEmpty")}</p>
                      ) : (
                        <NativeSelect
                          aria-label={t("createWorkspacePick")}
                          disabled={creating}
                          value={studioWorkspaceId}
                          onChange={setStudioWorkspaceId}
                          placeholder={t("createWorkspacePick")}
                          className="h-9 w-full"
                        >
                          {workspaces.map((workspace) => (
                            <option key={workspace.id} value={workspace.id}>
                              {workspace.name}
                            </option>
                          ))}
                        </NativeSelect>
                      )
                    ) : null}
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="workspace-mode"
                        className="accent-[#E52227]"
                        disabled={creating}
                        checked={workspaceMode === "create"}
                        onChange={() => setWorkspaceMode("create")}
                      />
                      {t("createWorkspaceNew")}
                    </label>
                    {workspaceMode === "create" ? (
                      <Input
                        value={newWorkspaceName}
                        onChange={(event) => setNewWorkspaceName(event.target.value)}
                        placeholder={t("createWorkspaceNamePlaceholder")}
                        disabled={creating}
                      />
                    ) : null}
                  </div>
                </Field>
              </>
            ) : null}
          </FieldGroup>
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            color="muted"
            onClick={() => onOpenChange(false)}
            disabled={creating}
          >
            {tc("cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={
              !name.trim() ||
              !description.trim() ||
              uploadingLogo ||
              creating ||
              plotTreeLoading ||
              (productionKind === "interactive_film" &&
                !!plotTreeIssues &&
                plotTreeIssues.length > 0) ||
              (!isEdit &&
                (workspaceMode === "link"
                  ? !studioWorkspaceId
                  : !newWorkspaceName.trim() && !name.trim()))
            }
          >
            {creating ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {isEdit
              ? creating
                ? t("editSubmitting")
                : t("editSubmit")
              : creating
                ? t("createSubmitting")
                : t("createSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
