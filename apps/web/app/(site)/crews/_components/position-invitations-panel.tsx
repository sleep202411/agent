"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useUserLookup } from "../_hooks/use-users";
import { crewApi, CrewApiError } from "../_hooks/api";

type Invitation = {
  id: string;
  positionId: string;
  inviteeUserId: string;
  status: "pending" | "accepted" | "declined" | "revoked";
  expiresAt: string;
  applicationId: string | null;
};
type Preview = Invitation & {
  expired: boolean;
  position: {
    positionType: string;
    description: string;
    experienceLevel: string;
    requiredSkills: string[];
  };
};
type Props = { positionId?: string; hideWhenEmpty?: boolean };
type Request = { path: string; body?: Record<string, unknown> };

/** Mounted only for authorized position managers, or on the recipient's private page. */
export function PositionInvitationsPanel(props: Props) {
  const { user } = useCurrentUser();
  if (!user) return null;
  return (
    <InvitationSession
      key={JSON.stringify([user.id, props.positionId])}
      {...props}
      userId={user.id}
    />
  );
}
function InvitationSession({ positionId, userId, hideWhenEmpty }: Props & { userId: string }) {
  const t = useTranslations("crewPositionInvites");
  const locale = useLocale();
  const client = useQueryClient();
  const base = positionId
    ? `/crew-positions/${encodeURIComponent(positionId)}/invitations`
    : "/crew-position-invitations";
  const queryKey = ["position-invitations", userId, positionId ?? null];
  const list = useInfiniteQuery({
    queryKey,
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      crewApi.get<{ items: Invitation[]; nextCursor: string | null }>(base, {
        signal,
        cache: "no-store",
        query: { limit: 20, cursor: pageParam },
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const preview = useQuery({
    queryKey: ["position-invitation-preview", userId, selected],
    enabled: !positionId && Boolean(selected),
    retry: false,
    queryFn: ({ signal }) =>
      crewApi.get<Preview>(`/crew-position-invitations/${encodeURIComponent(selected!)}`, {
        signal,
        cache: "no-store",
      }),
  });
  const [recipient, setRecipient] = useState("");
  const lookup = useUserLookup({ query: positionId ? recipient : "" });
  const [days, setDays] = useState("7");
  const [message, setMessage] = useState("");
  const [portfolio, setPortfolio] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState<Request | null>(null);
  const pending = useRef(false);
  const alive = useRef(true);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const readable = list.isSuccess && !list.isError;
  const items = readable ? list.data.pages.flatMap((page) => page.items) : [];
  async function submit(request: Request, recovery = false) {
    if (!alive.current || pending.current || !readable || (retry && !recovery)) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await crewApi.post(request.path, request.body ? { body: request.body } : undefined);
      if (!alive.current) return;
      setRetry(null);
      setMessage("");
      setPortfolio("");
      setRecipient("");
      await Promise.all([
        list.refetch(),
        selected ? preview.refetch() : Promise.resolve(),
        client.invalidateQueries({ queryKey: ["my-crew-applications", userId] }),
      ]);
    } catch (err) {
      if (!alive.current) return;
      setError(err instanceof Error ? err.message : t("failed"));
      const definitive =
        err instanceof CrewApiError && [400, 401, 403, 404, 409, 422].includes(err.status);
      setRetry(definitive ? null : request);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function invite() {
    const expiry = Number(days);
    if (
      lookup.kind !== "found" ||
      lookup.user.userId === userId ||
      !Number.isInteger(expiry) ||
      expiry < 1 ||
      expiry > 30
    ) {
      setError(t("invalid"));
      return;
    }
    void submit({
      path: base,
      body: {
        inviteeUserId: lookup.kind === "found" ? lookup.user.userId : "",
        expiresInDays: expiry,
      },
    });
  }
  function decide(action: "accept" | "decline") {
    if (
      !preview.isSuccess ||
      preview.isError ||
      !preview.data ||
      preview.data.inviteeUserId !== userId ||
      preview.data.status !== "pending" ||
      preview.data.expired ||
      new Date(preview.data.expiresAt).getTime() <= Date.now()
    )
      return;
    if (action === "accept" && portfolio.trim()) {
      try {
        const url = new URL(portfolio.trim());
        if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      } catch {
        setError(t("invalidPortfolio"));
        return;
      }
    }
    void submit({
      path: `/crew-position-invitations/${encodeURIComponent(preview.data.id)}/${action}`,
      ...(action === "accept"
        ? { body: { message: message.trim() || null, portfolioUrl: portfolio.trim() || null } }
        : {}),
    });
  }
  if (hideWhenEmpty && !positionId && readable && !items.length && !retry && !error) return null;

  return (
    <section className="space-y-3 rounded-lg border border-border p-4" aria-label={t("title")}>
      <h2 className="font-semibold">{t("title")}</h2>
      {(positionId || items.length > 0) && (
        <p className="text-sm text-muted-foreground">{t("help")}</p>
      )}
      {list.isPending && <p>{t("loading")}</p>}
      {list.isError && <p role="alert">{list.error.message}</p>}
      {error && <p role="alert">{error}</p>}
      <Button
        type="button"
        variant="outline"
        disabled={busy || list.isFetching}
        onClick={() => void list.refetch()}
      >
        {t("refresh")}
      </Button>
      {readable && (
        <>
          {retry && (
            <div>
              <p>{t("retryHelp")}</p>
              <Button disabled={busy} onClick={() => void submit(retry, true)}>
                {t("retry")}
              </Button>
            </div>
          )}
          {positionId && (
            <fieldset disabled={busy || Boolean(retry)} className="space-y-2">
              <label className="block">
                {t("recipient")}
                <Input
                  value={recipient}
                  maxLength={254}
                  onChange={(e) => setRecipient(e.target.value)}
                />
              </label>
              <label className="block">
                {t("days")}
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
              </label>
              {lookup.kind === "found" && <p>{lookup.user.nickname || lookup.user.userId}</p>}
              {lookup.kind === "loading" && <p>{t("loading")}</p>}
              {lookup.kind === "notFound" && <p>{t("notFound")}</p>}
              {lookup.kind === "error" && <p role="alert">{lookup.message}</p>}
              <Button type="button" disabled={lookup.kind !== "found"} onClick={invite}>
                {t("invite")}
              </Button>
            </fieldset>
          )}
          {!items.length && <p>{t("empty")}</p>}
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id} className="space-y-1">
                <p>
                  {positionId ? item.inviteeUserId : t("invitation")} · {t(item.status)} ·{" "}
                  {t("expires", { date: new Date(item.expiresAt).toLocaleString(locale) })}
                </p>
                {positionId ? (
                  item.status === "pending" && (
                    <Button
                      variant="outline"
                      disabled={busy || Boolean(retry)}
                      onClick={() =>
                        void submit({
                          path: `/crew-position-invitations/${encodeURIComponent(item.id)}/revoke`,
                        })
                      }
                    >
                      {t("revoke")}
                    </Button>
                  )
                ) : (
                  <Button
                    variant="outline"
                    disabled={busy || Boolean(retry)}
                    onClick={() => {
                      setSelected(item.id);
                      setMessage("");
                      setPortfolio("");
                      setError("");
                    }}
                  >
                    {t("view")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {list.hasNextPage && (
            <Button disabled={list.isFetching || busy} onClick={() => void list.fetchNextPage()}>
              {t("more")}
            </Button>
          )}
          {!positionId && selected && (
            <div className="space-y-2">
              {preview.isPending && <p>{t("loading")}</p>}
              {preview.isError && <p role="alert">{preview.error.message}</p>}
              <Button
                variant="outline"
                disabled={busy || preview.isFetching}
                onClick={() => void preview.refetch()}
              >
                {t("refresh")}
              </Button>
              {preview.isSuccess && !preview.isError && (
                <>
                  <h3>{preview.data.position.positionType}</h3>
                  <p className="whitespace-pre-wrap">{preview.data.position.description}</p>
                  <p>{preview.data.position.requiredSkills.join(", ")}</p>
                  <p>{t(preview.data.status)}</p>
                  {preview.data.expired && <p>{t("expired")}</p>}
                  {preview.data.status === "accepted" && <p>{t("acceptedHelp")}</p>}
                  {preview.data.inviteeUserId === userId &&
                    preview.data.status === "pending" &&
                    !preview.data.expired && (
                      <fieldset disabled={busy || Boolean(retry)} className="space-y-2">
                        <label className="block">
                          {t("message")}
                          <Textarea
                            maxLength={1000}
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                          />
                        </label>
                        <label className="block">
                          {t("portfolio")}
                          <Input
                            maxLength={512}
                            value={portfolio}
                            onChange={(e) => setPortfolio(e.target.value)}
                          />
                        </label>
                        <Button onClick={() => decide("accept")}>{t("accept")}</Button>
                        <Button variant="outline" onClick={() => decide("decline")}>
                          {t("decline")}
                        </Button>
                      </fieldset>
                    )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
