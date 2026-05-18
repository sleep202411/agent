"use client";

import { Button } from "@/components/ui/button";
import { useTranslations } from "@/src/i18n/i18n";
import { useAppDispatch, useAppSelector } from "@/src/store";
import { applyPersonaAction } from "@/src/store/slices/assistantSlice";
import type { SuggestedAction } from "@/src/lib/assistant/suggested-action";

/**
 * Renders 1-N generative-UI action buttons emitted by supervisor. The
 * first is the primary CTA (soft/primary), the rest default to outline
 * so the visual hierarchy matches supervisor's ordering. Each click
 * sends "应用上面的方案：<label>" back to supervisor, which finds the
 * matching action in its own previous JSON block and invokes the tool.
 *
 * `disabled` is true when the message is no longer the last assistant
 * message — clicking a stale action doesn't make sense once the
 * conversation has moved on.
 */
export function SuggestedActionButtons({
  actions,
  disabled,
}: {
  actions: SuggestedAction[];
  disabled?: boolean;
}) {
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-col items-stretch gap-2">
      {actions.map((action, index) => (
        <SuggestedActionButton
          key={`${action.tool}:${action.label}`}
          action={action}
          primary={index === 0}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

function SuggestedActionButton({
  action,
  primary,
  disabled,
}: {
  action: SuggestedAction;
  primary: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("ai");
  const dispatch = useAppDispatch();
  const projectId = useAppSelector((s) => s.project.currentProjectId);
  const sending = useAppSelector((s) =>
    projectId ? Boolean(s.assistant.projects[projectId]?.sending) : false
  );

  const handleClick = () => {
    if (!projectId || sending || disabled) return;
    void dispatch(applyPersonaAction({ projectId, label: action.label }));
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant={primary ? "soft" : "outline"}
        color={primary ? "primary" : "muted"}
        size="lg"
        onClick={handleClick}
        disabled={disabled || sending}
        className="gap-1.5 w-full"
      >
        {action.label}
      </Button>
      {typeof action.estimatedCost === "number" && action.estimatedCost > 0 && (
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {t("personaActionCost", { cost: action.estimatedCost })}
        </span>
      )}
    </div>
  );
}
