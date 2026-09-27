"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { IconDots } from "@tabler/icons-react";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { crewApi, CrewApiError } from "../_hooks/api";
import { crewKeys, crewAccountQueries } from "../_hooks/shared";
import type { CrewTaskDTO } from "../_hooks/types";

type Props = { task: CrewTaskDTO; canManage: boolean };
type Closure = { requestId: string; expectedVersion: number; reason: string };
export function TaskClosureControl(props: Props) {
  const { user } = useCurrentUser();
  if (!user || !props.canManage) return null;
  return (
    <ClosureSession
      key={JSON.stringify([user.id, props.task.id])}
      task={props.task}
      userId={user.id}
    />
  );
}
function ClosureSession({ task, userId }: { task: CrewTaskDTO; userId: string }) {
  const t = useTranslations("crewClosure");
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [retry, setRetry] = useState<Closure | null>(null);
  const alive = useRef(true),
    pending = useRef(false);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const eligible = !["submitted", "approved", "cancelled"].includes(task.status);
  const stale = version !== null && task.version !== version;
  function changeOpen(value: boolean) {
    if (pending.current) return;
    if (value) setVersion((previous) => previous ?? task.version);
    setOpen(value);
  }
  function discard() {
    if (pending.current || retry) return;
    setReason("");
    setError("");
    setVersion(task.version);
  }
  async function close(recovery?: Closure) {
    if (!alive.current || pending.current || done || (!recovery && (!eligible || stale || retry)))
      return;
    if (!recovery && !reason.trim()) {
      setError(t("required"));
      return;
    }
    const body = recovery ?? {
      requestId: crypto.randomUUID(),
      expectedVersion: version ?? task.version,
      reason: reason.trim(),
    };
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await crewApi.post(`/crew-tasks/${encodeURIComponent(task.id)}/close`, { body });
    } catch (err) {
      if (alive.current) {
        setError(err instanceof Error ? err.message : t("failed"));
        setRetry(
          err instanceof CrewApiError && [400, 401, 403, 404, 409, 422].includes(err.status)
            ? null
            : body
        );
        setBusy(false);
      }
      pending.current = false;
      return;
    }
    if (!alive.current) {
      pending.current = false;
      return;
    }
    setDone(true);
    setRetry(null);
    setOpen(false);
    setReason("");
    // A successful write remains successful even if refreshing the views fails.
    await Promise.allSettled(
      [
        crewKeys.task(task.id),
        crewKeys.tasks(task.crewId),
        crewKeys.taskCenter,
        crewKeys.taskSummary(task.crewId),
        crewKeys.taskActivity(task.crewId),
        crewKeys.productionOverview(task.crewId),
      ].map((key) => client.invalidateQueries(crewAccountQueries(key, userId)))
    );
    pending.current = false;
    if (alive.current) setBusy(false);
  }
  if (done)
    return (
      <span role="status" className="text-sm text-muted-foreground">
        {t("done")}
      </span>
    );
  if (!eligible && !retry) return null;
  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("title")}
          className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary"
        >
          <IconDots className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <h3 className="font-semibold">{t("title")}</h3>
        <p className="text-sm text-muted-foreground">{t("notice")}</p>
        {error && <p role="alert">{error}</p>}
        {retry ? (
          <>
            <p>{t("retryHelp")}</p>
            <Button color="destructive" disabled={busy} onClick={() => void close(retry)}>
              {t("retry")}
            </Button>
          </>
        ) : (
          <>
            <label className="block text-sm">
              {t("reason")}
              <Textarea
                maxLength={4000}
                disabled={busy}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {stale && <p role="alert">{t("stale")}</p>}
            <Button
              color="destructive"
              disabled={busy || stale || !reason.trim()}
              onClick={() => void close()}
            >
              {t("confirm")}
            </Button>
            <Button variant="outline" disabled={busy} onClick={discard}>
              {t("discard")}
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
