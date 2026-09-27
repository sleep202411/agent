"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useTranslations } from "@/src/i18n/i18n";
import { crewApi } from "../_hooks/api";
import {
  attachmentFileError,
  validEvidenceUrl,
  type CaseAttachment,
  useCaseAttachments,
} from "../_hooks/use-case-attachments";

type Upload = {
  id: string;
  file: File;
  stage: "prepare" | "put" | "confirm";
  placement?: { url: string; method: string; headers: Record<string, string>; expiresAt: string };
};
export function CaseEvidence({
  userId,
  caseId,
  disabled,
  selected,
  onSelect,
  onBusy,
}: {
  userId: string;
  caseId: string;
  disabled: boolean;
  selected: string[];
  onSelect: (ids: string[]) => void;
  onBusy: (busy: boolean) => void;
}) {
  const t = useTranslations("crewEvidence"),
    client = useQueryClient();
  const query = useCaseAttachments(userId, caseId, true);
  const alive = useRef(true),
    pending = useRef(false),
    abort = useRef<AbortController | null>(null);
  const [upload, setUpload] = useState<Upload | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const base = `/crew-disputes/${encodeURIComponent(caseId)}/attachments`;
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abort.current?.abort();
      onBusy(false);
    };
  }, [onBusy]);
  const readable = query.isSuccess && !query.isError;
  const items = readable ? query.data.pages.flatMap((p) => p.items) : [];
  async function refresh() {
    await Promise.allSettled([
      client.invalidateQueries({ queryKey: ["crew-cases", userId, "attachments", caseId] }),
    ]);
  }
  async function run(next: Upload) {
    if (pending.current || disabled || !alive.current) return;
    pending.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    const controller = new AbortController();
    abort.current = controller;
    let current = next;
    setUpload(current);
    try {
      if (current.stage === "prepare") {
        const placement = await crewApi.post<NonNullable<Upload["placement"]>>(
          `${base}/${current.id}`,
          {
            signal: controller.signal,
            body: {
              name: current.file.name,
              contentType: current.file.type,
              sizeBytes: current.file.size,
            },
          }
        );
        if (!alive.current) return;
        current = { ...current, placement, stage: "put" };
        setUpload(current);
      }
      if (current.stage === "put") {
        const p = current.placement!;
        if (!validEvidenceUrl(p.url) || p.method !== "PUT") throw new Error(t("invalidUrl"));
        if (!Number.isFinite(Date.parse(p.expiresAt)) || Date.parse(p.expiresAt) <= Date.now())
          throw new Error(t("expired"));
        const response = await fetch(p.url, {
          method: "PUT",
          headers: p.headers,
          body: current.file,
          credentials: "omit",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(t("uploadFailed", { status: response.status }));
        if (!alive.current) return;
        current = { ...current, stage: "confirm" };
        setUpload(current);
      }
      await crewApi.post(`${base}/${current.id}/confirm`, { signal: controller.signal });
      if (!alive.current) return;
      setUpload(null);
      await refresh();
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      pending.current = false;
      if (alive.current) {
        setBusy(false);
        onBusy(false);
      }
    }
  }
  return (
    <section className="space-y-3 py-3" aria-label={t("title")}>
      <h3 className="font-semibold">{t("title")}</h3>
      <p className="text-sm text-muted-foreground">{t("privacy")}</p>
      <label className="block">
        {t("upload")}
        <Input
          type="file"
          accept="application/pdf,image/png,image/jpeg"
          disabled={disabled || busy || Boolean(upload) || !readable}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            if (attachmentFileError(file)) {
              setError(t("fileInvalid"));
              return;
            }
            void run({ id: crypto.randomUUID(), file, stage: "prepare" });
          }}
        />
      </label>
      <p className="text-sm text-muted-foreground">{t("limits")}</p>
      {busy && <p role="status">{t("uploading")}</p>}
      {error && <p role="alert">{error}</p>}
      {upload && !busy && (
        <div className="space-y-2">
          <p>{t("recover", { name: upload.file.name })}</p>
          <Button disabled={disabled} onClick={() => void run(upload)}>
            {t("retry")}
          </Button>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => void run({ ...upload, stage: "confirm" })}
          >
            {t("confirmStored")}
          </Button>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => {
              setUpload(null);
              setError("");
              void refresh();
            }}
          >
            {t("abandon")}
          </Button>
          <p className="text-sm text-muted-foreground">{t("abandonHelp")}</p>
        </div>
      )}
      <Button
        variant="outline"
        disabled={disabled || busy || query.isFetching}
        onClick={() => void query.refetch()}
      >
        {t("refresh")}
      </Button>
      {query.isPending && <p>{t("loading")}</p>}
      {query.isError && <p role="alert">{query.error.message}</p>}
      {readable && !items.length && <p>{t("empty")}</p>}
      {items.map((item) => (
        <EvidenceRow
          key={item.id}
          item={item}
          base={base}
          disabled={disabled || busy}
          selected={selected.includes(item.id)}
          maxSelected={selected.length >= 20}
          onToggle={(checked) =>
            onSelect(
              checked
                ? [...new Set([...selected, item.id])]
                : selected.filter((id) => id !== item.id)
            )
          }
          onConfirmed={refresh}
        />
      ))}
      {readable && query.hasNextPage && (
        <Button
          disabled={disabled || busy || query.isFetching}
          onClick={() => void query.fetchNextPage()}
        >
          {t("more")}
        </Button>
      )}
    </section>
  );
}
function EvidenceRow({
  item,
  base,
  disabled,
  selected,
  maxSelected,
  onToggle,
  onConfirmed,
}: {
  item: CaseAttachment;
  base: string;
  disabled: boolean;
  selected: boolean;
  maxSelected: boolean;
  onToggle: (checked: boolean) => void;
  onConfirmed: () => Promise<unknown>;
}) {
  const t = useTranslations("crewEvidence");
  const alive = useRef(true),
    pending = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!link) return;
    const timer = setTimeout(
      () => setLink(null),
      Math.min(2147483647, Math.max(0, Date.parse(link.expiresAt) - Date.now()))
    );
    return () => clearTimeout(timer);
  }, [link]);
  async function action(confirm: boolean) {
    if (disabled || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setLink(null);
    try {
      if (confirm) {
        await crewApi.post(`${base}/${item.id}/confirm`);
        if (alive.current) await onConfirmed();
      } else {
        const result = await crewApi.get<{ url: string; expiresAt: string }>(
          `${base}/${item.id}/read`,
          { cache: "no-store" }
        );
        if (
          !validEvidenceUrl(result.url) ||
          !Number.isFinite(Date.parse(result.expiresAt)) ||
          Date.parse(result.expiresAt) <= Date.now()
        )
          throw new Error(t("invalidUrl"));
        if (alive.current) setLink(result);
      }
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <p className="break-words">
        {item.name} · {item.sizeBytes.toLocaleString()} {t("bytes")}
      </p>
      <p>{t(item.shared ? "shared" : item.ready ? "private" : "unconfirmed")}</p>
      {item.ready && !item.shared && (
        <label className="flex items-center gap-2">
          <Checkbox
            disabled={disabled || busy || (!selected && maxSelected)}
            checked={selected}
            onCheckedChange={(v) => onToggle(v === true)}
          />
          {t("select")}
        </label>
      )}
      {error && <p role="alert">{error}</p>}
      {item.ready ? (
        <Button variant="outline" disabled={disabled || busy} onClick={() => void action(false)}>
          {t("requestRead")}
        </Button>
      ) : (
        !item.shared && (
          <Button variant="outline" disabled={disabled || busy} onClick={() => void action(true)}>
            {t("confirmStored")}
          </Button>
        )
      )}
      {link && (
        <a
          className="text-primary underline"
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
        >
          {t("openFile")}
        </a>
      )}
    </div>
  );
}
