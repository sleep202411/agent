"use client";

import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { NativeSelect } from "@/components/ui/native-select";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "@/src/i18n/i18n";
import { useCurrentUser } from "@/src/hooks/use-user";
import { StudioComposer } from "../../../_components/studio-composer";
import {
  estimateModelSellPoints,
  defaultSettingsForModel,
  isFizzAiModelUsable,
  listFizzAiCatalog,
  normalizeFizzAiError,
  type FizzAiJobType,
} from "../../../../_lib/generation-api";
import { MIN_CANVAS_ZOOM, NODE_COMPOSER_GAP, NODE_COMPOSER_WIDTH } from "./canvas-constants";
import {
  canvasGenerationInput,
  canvasImageReferenceFields,
  invalidCanvasGenerationFields,
  type CanvasGenerationDraft,
  type CanvasGenerationRequest,
} from "./canvas-generation";
import type { NodeComposerLayout } from "./shot-node";

export type CanvasGenerationComposerProps = {
  type: FizzAiJobType;
  initial: CanvasGenerationDraft;
  layout: NodeComposerLayout;
  zoom: number;
  busy?: boolean;
  referenceUrl?: string;
  onChange: (draft: CanvasGenerationDraft) => void;
  onSubmit?: (request: CanvasGenerationRequest) => Promise<void>;
};

export function CanvasGenerationComposer(props: CanvasGenerationComposerProps) {
  const { user } = useCurrentUser();
  return <ComposerSession key={user?.id ?? "guest"} {...props} userId={user?.id} />;
}

function ComposerSession({
  initial,
  layout,
  zoom,
  type,
  busy,
  referenceUrl,
  onChange,
  onSubmit,
  userId,
}: CanvasGenerationComposerProps & { userId?: string }) {
  const t = useTranslations("fizzStudio");
  const [draft, setDraft] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const catalog = useQuery({
    queryKey: ["fizzstudio", "canvas-model-catalog", userId],
    queryFn: listFizzAiCatalog,
    enabled: !!userId,
    retry: false,
  });
  const models = catalog.isError
    ? []
    : (catalog.data?.models ?? []).filter((model) => model.type === type);
  const selectedModel = models.find((model) => model.id === draft.modelId);
  const modelUsable =
    !!selectedModel &&
    isFizzAiModelUsable(selectedModel) &&
    draft.schemaVersion === selectedModel.schemaVersion;
  const input = selectedModel ? canvasGenerationInput(selectedModel, draft, referenceUrl) : null;
  const invalidFields =
    selectedModel && input ? invalidCanvasGenerationFields(selectedModel, input) : [];
  const referenceMissing =
    !!draft.referenceField &&
    (!referenceUrl ||
      !canvasImageReferenceFields(selectedModel).some(([name]) => name === draft.referenceField));
  const modelError =
    draft.modelId && !catalog.isPending && !catalog.isError && !modelUsable
      ? t("sbCanvasModelUnavailable")
      : null;
  const validationError = invalidFields.length
    ? t("sbCanvasInvalidSettings", { fields: invalidFields.join(", ") })
    : referenceMissing
      ? t("sbCanvasReferenceUnavailable")
      : null;
  const canSubmit =
    !!userId &&
    !!onSubmit &&
    modelUsable &&
    !!draft.prompt.trim() &&
    !busy &&
    !submitting &&
    !catalog.isFetching &&
    !validationError;
  const update = (next: CanvasGenerationDraft) => {
    setDraft(next);
    onChange(next);
    setSubmitError(null);
  };
  const submit = async () => {
    if (!canSubmit || !selectedModel || !input || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit?.({
        modelId: selectedModel.id,
        schemaVersion: selectedModel.schemaVersion,
        input,
      });
    } catch (error) {
      if (alive.current) setSubmitError(normalizeFizzAiError(error, t("sbGenerationSubmitFailed")));
    } finally {
      inFlight.current = false;
      if (alive.current) {
        setSubmitting(false);
        void catalog.refetch();
      }
    }
  };
  const safeZoom = Math.max(zoom || 1, MIN_CANVAS_ZOOM);
  const stop = (event: SyntheticEvent) => event.stopPropagation();
  return (
    <div
      data-fizz-canvas-composer="true"
      className={`node-floating-ui nodrag nowheel nopan absolute left-1/2 z-30 ${layout.placement === "bottom" ? "top-full" : "bottom-full"}`}
      onClick={stop}
      onDoubleClick={stop}
      onKeyDown={stop}
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onWheel={stop}
      style={{
        width: NODE_COMPOSER_WIDTH,
        marginLeft: -NODE_COMPOSER_WIDTH / 2 + layout.offsetX / safeZoom,
        marginTop: layout.placement === "bottom" ? NODE_COMPOSER_GAP / safeZoom : undefined,
        marginBottom: layout.placement === "top" ? NODE_COMPOSER_GAP / safeZoom : undefined,
        transform: `scale(${1 / safeZoom})`,
        transformOrigin: layout.placement === "bottom" ? "top center" : "bottom center",
      }}
    >
      <StudioComposer
        embedded
        models={models}
        catalogLoading={catalog.isPending}
        catalogError={catalog.isError}
        selectedModelId={draft.modelId}
        settings={draft.settings}
        prompt={draft.prompt}
        submitting={submitting || !!busy}
        submitError={
          submitError ||
          (catalog.isError
            ? normalizeFizzAiError(catalog.error, t("sbCanvasCatalogFailed"))
            : modelError || validationError)
        }
        priceEstimate={
          selectedModel ? estimateModelSellPoints(selectedModel, draft.settings) : null
        }
        canSubmit={canSubmit}
        onPromptChange={(prompt) => update({ ...draft, prompt })}
        onSubmit={() => void submit()}
        onSelectModel={(modelId) => {
          const model = models.find((item) => item.id === modelId);
          if (!model || !isFizzAiModelUsable(model)) return;
          const settings = defaultSettingsForModel(model);
          if (type === "image") {
            for (const key of ["aspectRatio", "aspect_ratio"]) {
              if (model.input_schema.properties?.[key]?.enum?.includes("2:1"))
                settings[key] = "2:1";
            }
          }
          update({
            ...draft,
            modelId,
            schemaVersion: model.schemaVersion,
            settings,
            referenceField: "",
          });
        }}
        onSettingsChange={(settings) => update({ ...draft, settings })}
        onRetryCatalog={() => void catalog.refetch()}
      />
      {referenceUrl || draft.referenceField ? (
        <label className="mt-2 flex items-center gap-3 rounded-lg bg-[#141416] px-3 py-2 text-xs text-white/75">
          {t("sbCanvasReferenceField")}
          <NativeSelect
            aria-label={t("sbCanvasReferenceField")}
            className="min-w-0 flex-1 rounded bg-[#242426] p-2"
            value={draft.referenceField}
            disabled={submitting || !!busy}
            onChange={(referenceField) => update({ ...draft, referenceField })}
          >
            <option value="">{t("sbCanvasNoReference")}</option>
            {canvasImageReferenceFields(selectedModel).map(([name, prop]) => (
              <option key={name} value={name}>
                {name === "startFrame"
                  ? t("sbCanvasStartFrame")
                  : name === "endFrame"
                    ? t("sbCanvasEndFrame")
                    : ["referenceImages", "input_reference"].includes(name)
                      ? t("sbCanvasReferenceImage")
                      : prop.title || name}
              </option>
            ))}
          </NativeSelect>
        </label>
      ) : null}
    </div>
  );
}
