"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAdminOperation } from "../use-admin-operation";
import {
  caseRequest,
  CaseApiError,
  type CaseRecord,
  type CasePage,
  type CaseDetail,
  type CaseWrite,
} from "@/lib/admin-crew-disputes";
import { caseCopy, type CaseCopy } from "./case-copy";

function useRead<T>(path: string, merge: (old: T, next: T) => T) {
  const { begin, busy } = useAdminOperation();
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState("");
  const load = useCallback(
    async (nextPath = path, append = false) => {
      const op = begin("read");
      if (!op) return;
      setError("");
      try {
        const next = await caseRequest<T>(nextPath, op.signal);
        if (op.current()) setData((old) => (append && old ? merge(old, next) : next));
      } catch (e) {
        if (op.current()) {
          setData(null);
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        op.finish();
      }
    },
    [path, begin, merge]
  );
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    return () => {
      active = false;
    };
  }, [load]);
  return { data, error, busy, load };
}
const mergeCases = (a: CasePage, b: CasePage): CasePage => ({
  ...b,
  items: [...a.items, ...b.items.filter((r) => !a.items.some((p) => p.id === r.id))],
});
const mergeHistory = (a: CaseDetail, b: CaseDetail): CaseDetail => ({
  ...b,
  events: [...a.events, ...b.events.filter((r) => !a.events.some((p) => p.id === r.id))],
});

export function CaseOperationsPanel({ adminId, site }: { adminId: string; site: string }) {
  const [locale, setLocale] = useState<keyof typeof caseCopy>("en-US");
  const [id, setId] = useState<string | null>(null);
  const t = caseCopy[locale];
  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t.title}</h1>
          <p className="text-sm text-muted-foreground">{site}</p>
        </div>
        <div aria-label={t.language} className="flex gap-2">
          {(["en-US", "zh-CN", "zh-HK"] as const).map((l) => (
            <Button
              key={l}
              variant="outline"
              aria-pressed={locale === l}
              onClick={() => setLocale(l)}
            >
              {l === "en-US" ? "English" : l === "zh-CN" ? "简体中文" : "繁體中文"}
            </Button>
          ))}
        </div>
      </header>
      {id ? (
        <CaseView key={id} id={id} adminId={adminId} t={t} back={() => setId(null)} />
      ) : (
        <CaseQueue t={t} select={setId} />
      )}
    </section>
  );
}
function CaseQueue({ t, select }: { t: CaseCopy; select: (id: string) => void }) {
  const q = useRead<CasePage>("?limit=20", mergeCases);
  return (
    <div className="space-y-3">
      <Button disabled={q.busy} onClick={() => void q.load()}>
        {t.refresh}
      </Button>
      {q.busy && <p role="status">{t.loading}</p>}
      {q.error && <p role="alert">{q.error}</p>}
      {q.data && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {[t.case, t.status, t.owner, t.parties, t.date].map((label) => (
                    <th className="p-2" key={label}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((row) => (
                  <tr className="border-b align-top" key={row.id}>
                    <td className="p-2">
                      <p>{row.title}</p>
                      <Button variant="outline" onClick={() => select(row.id)}>
                        {t.view}
                      </Button>
                    </td>
                    <td className="p-2">{t[row.status]}</td>
                    <td className="p-2">{row.ownerAdminId ?? t.unclaimed}</td>
                    <td className="p-2">
                      {row.openedByUserId} / {row.respondentUserId}
                    </td>
                    <td className="p-2">{row.createdAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!q.data.items.length && <p>{t.empty}</p>}
          {q.data.nextBeforeId && (
            <Button
              disabled={q.busy}
              onClick={() =>
                void q.load(`?limit=20&beforeId=${encodeURIComponent(q.data!.nextBeforeId!)}`, true)
              }
            >
              {t.more}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
function CaseView({
  id,
  adminId,
  t,
  back,
}: {
  id: string;
  adminId: string;
  t: CaseCopy;
  back: () => void;
}) {
  const path = `/${encodeURIComponent(id)}`;
  const q = useRead<CaseDetail>(`${path}?limit=20`, mergeHistory);
  const write = useAdminOperation();
  const [draft, setDraft] = useState<{
    version: number;
    action: CaseWrite["action"];
    message: string;
  } | null>(null);
  const [review, setReview] = useState(false),
    [retry, setRetry] = useState<CaseWrite | null>(null);
  const [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [denied, setDenied] = useState(false);
  const row = !denied && !q.error ? q.data : null;
  const allowed = (action: CaseWrite["action"]) =>
    Boolean(
      row &&
      row.status !== "resolved" &&
      (action !== "resolve" || (row.status === "in_review" && row.ownerAdminId === adminId))
    );
  const stale = Boolean(draft && row && draft.version !== row.version);
  async function submit(body: CaseWrite) {
    if (!row || q.busy || (!retry && (!allowed(body.action) || stale))) return;
    const op = write.begin();
    if (!op) return;
    setError("");
    try {
      const result = await caseRequest<CaseRecord>(`${path}/events`, op.signal, body);
      if (result.id !== id || result.version < body.expectedVersion + 1) throw new Error(t.failed);
      if (!op.current()) return;
      setRetry(null);
      setDraft(null);
      setReview(false);
      setSaved(true);
      void q.load();
    } catch (e) {
      if (op.current()) {
        setError(e instanceof Error ? e.message : t.failed);
        const definitive =
          e instanceof CaseApiError && [400, 401, 403, 404, 409, 422].includes(e.status);
        setRetry(definitive ? null : body);
        setReview(false);
        if (e instanceof CaseApiError && [401, 403, 404].includes(e.status)) setDenied(true);
      }
    } finally {
      op.finish();
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button variant="outline" disabled={write.busy} onClick={back}>
          {t.back}
        </Button>
        <Button
          disabled={q.busy || write.busy}
          onClick={() => {
            setDenied(false);
            void q.load();
          }}
        >
          {t.refresh}
        </Button>
      </div>
      {q.busy && <p role="status">{t.loading}</p>}
      {q.error && <p role="alert">{q.error}</p>}
      {error && <p role="alert">{error}</p>}
      {saved && <p role="status">{t.saved}</p>}
      {row && (
        <>
          <h2 className="font-semibold">{row.title}</h2>
          {row.category && (
            <p>
              {t.category}: {t.categories[row.category]}
            </p>
          )}
          {row.desiredResolution && (
            <p>
              {t.desiredResolution}: {t.resolutions[row.desiredResolution]}
            </p>
          )}
          <p className="text-sm">
            {t.case}: {row.id} · {t.task}: {row.taskId} · {t.version}: {row.version}
          </p>
          <p>
            {t[row.status]} · {t.owner}: {row.ownerAdminId ?? t.unclaimed}
          </p>
          <p>
            {t.parties}: {row.openedByUserId} / {row.respondentUserId}
          </p>
          <p className="text-sm text-muted-foreground">{t.boundary}</p>
          {retry ? (
            <div>
              <p>{t.retryHelp}</p>
              <Button disabled={write.busy || q.busy} onClick={() => void submit(retry)}>
                {t.retry}
              </Button>
            </div>
          ) : (
            <>
              {row.status === "resolved" ? (
                <p>{t.closed}</p>
              ) : (
                <div className="flex gap-2">
                  {(["claim", "message", "resolve"] as const).filter(allowed).map((action) => (
                    <Button
                      key={action}
                      disabled={write.busy || q.busy || Boolean(draft)}
                      onClick={() => {
                        setDraft({ version: row.version, action, message: "" });
                        setReview(false);
                        setSaved(false);
                      }}
                    >
                      {t[action]}
                    </Button>
                  ))}
                </div>
              )}
              {draft && (
                <div className="space-y-2">
                  <h3>{t[draft.action]}</h3>
                  <label>
                    {t.reason}
                    <Textarea
                      value={draft.message}
                      maxLength={4000}
                      disabled={write.busy || review}
                      onChange={(e) => setDraft({ ...draft, message: e.target.value })}
                    />
                  </label>
                  {stale && <p role="alert">{t.stale}</p>}
                  {review && <p>{t.confirmation}</p>}
                  <Button
                    disabled={
                      write.busy ||
                      q.busy ||
                      stale ||
                      !allowed(draft.action) ||
                      !draft.message.trim()
                    }
                    onClick={() =>
                      review
                        ? void submit({
                            requestKey: crypto.randomUUID(),
                            expectedVersion: draft.version,
                            action: draft.action,
                            message: draft.message.trim(),
                            submissionIds: [],
                          })
                        : setReview(true)
                    }
                  >
                    {review ? t.send : t.review}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={write.busy}
                    onClick={() => {
                      if (review) setReview(false);
                      else setDraft(null);
                    }}
                  >
                    {review ? t.cancel : t.discard}
                  </Button>
                </div>
              )}
            </>
          )}
          <h3 className="font-semibold">{t.history}</h3>
          <ol className="divide-y">
            {row.events.map((event) => (
              <li className="space-y-2 py-3" key={event.id}>
                <p>
                  {t.version} {event.version} ·{" "}
                  {typeof t[event.action as keyof CaseCopy] === "string"
                    ? String(t[event.action as keyof CaseCopy])
                    : event.action}{" "}
                  · {t.actor}: {event.actorKind === "admin" ? t.admin : t.user} {event.actorId} ·{" "}
                  {event.createdAt}
                </p>
                <p className="whitespace-pre-wrap break-words">{event.message}</p>
                {event.submissionIds.length > 0 && (
                  <p>
                    {t.submissions}: {event.submissionIds.join(", ")}
                  </p>
                )}
                {event.attachmentIds.map((attachment) => (
                  <EvidenceLink
                    key={attachment}
                    path={`${path}/attachments/${encodeURIComponent(attachment)}/read`}
                    id={attachment}
                    t={t}
                  />
                ))}
              </li>
            ))}
          </ol>
          {row.nextBeforeVersion && (
            <Button
              disabled={q.busy || write.busy}
              onClick={() =>
                void q.load(`${path}?limit=20&beforeVersion=${row.nextBeforeVersion}`, true)
              }
            >
              {t.more}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
function EvidenceLink({ path, id, t }: { path: string; id: string; t: CaseCopy }) {
  const op = useAdminOperation();
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!link) return;
    const timer = setTimeout(
      () => setLink(null),
      Math.min(60000, Math.max(0, Date.parse(link.expiresAt) - Date.now()))
    );
    return () => clearTimeout(timer);
  }, [link]);
  async function read() {
    const request = op.begin("read");
    if (!request) return;
    setLink(null);
    setError("");
    try {
      const result = await caseRequest<{ url: string; expiresAt: string }>(path, request.signal);
      if (
        new URL(result.url).protocol !== "https:" ||
        !Number.isFinite(Date.parse(result.expiresAt)) ||
        Date.parse(result.expiresAt) <= Date.now()
      )
        throw new Error(t.invalidLink);
      if (request.current()) setLink(result);
    } catch (e) {
      if (request.current()) setError(e instanceof Error ? e.message : t.failed);
    } finally {
      request.finish();
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span>
        {t.evidence}: {id}
      </span>
      <Button variant="outline" disabled={op.busy} onClick={() => void read()}>
        {t.download}
      </Button>
      {link && (
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
          onClick={(e) => {
            if (Date.parse(link.expiresAt) <= Date.now()) {
              e.preventDefault();
              setLink(null);
              setError(t.expired);
            }
          }}
        >
          {t.openFile}
        </a>
      )}
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
