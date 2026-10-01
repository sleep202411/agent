"use client";
import { useState } from "react";
import type {
  DiscoveryAssistantRequest,
  DiscoveryAssistantResult,
} from "@repo/shared/discovery-assistant";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { useDiscoveryAssistant } from "../_hooks/use-discovery-assistant";

type Results = Extract<DiscoveryAssistantResult, { status: "results" }>;
export function DiscoveryAssistant({
  viewerId,
  current,
  currentValid = true,
  onProposal,
  genreLabels = [],
  onReview,
  onApply,
}: {
  viewerId: string | null;
  current: DiscoveryAssistantRequest["conversation"]["current"];
  currentValid?: boolean;
  onProposal: (result: Results) => void;
  genreLabels?: { code: string; label: string }[];
  onReview: (result: Results) => void;
  onApply: (result: Results, selectedId?: string) => void;
}) {
  const t = useTranslations("discoveryAssistant");
  const locale = useLocale() as DiscoveryAssistantRequest["locale"];
  const auth = useAuthDialog();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const assistant = useDiscoveryAssistant({
    viewerId,
    locale,
    current,
    onProposal,
    copy: {
      storage: t("storage"),
      mismatch: t("mismatch"),
      invalid: t("invalid"),
      resultSummary: (count) => t("resultSummary", { count }),
    },
  });
  const result = assistant.receipt?.result;
  const busy = assistant.busy;
  const review = (value: Results) => {
    onReview(value);
    setOpen(false);
  };
  const apply = (value: Results, selectedId?: string) => {
    onApply(value, selectedId);
    setOpen(false);
  };
  const body = (
    <div className="space-y-4">
      {!viewerId || assistant.denied ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("loginHint")}</p>
          <Button onClick={() => auth.open()}>{t("login")}</Button>
        </div>
      ) : (
        <>
          <ol
            aria-label={t("conversation")}
            className="max-h-72 space-y-3 overflow-y-auto text-sm"
            aria-live="polite"
          >
            {assistant.history.map((message, index) => (
              <li key={index} className="space-y-1 rounded-xl bg-muted/25 p-3 wrap-anywhere">
                <span className="text-xs font-medium text-muted-foreground">
                  {t(message.role === "user" ? "you" : "title")}
                </span>
                <p className="whitespace-pre-wrap">{message.content}</p>
              </li>
            ))}
          </ol>
          {assistant.error && (
            <p role="alert" className="text-sm wrap-anywhere">
              {assistant.error}
            </p>
          )}
          {busy && (
            <p role="status" className="text-sm">
              {t("working")}
            </p>
          )}
          {assistant.request &&
            (!assistant.receipt || assistant.receipt.status !== "succeeded") && (
              <div className="space-y-2 text-sm">
                {!busy && (
                  <p>
                    {t(
                      assistant.receipt?.status === "uncertain"
                        ? "uncertain"
                        : assistant.receipt?.status === "cancelled"
                          ? "cancelled"
                          : "recover"
                    )}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" disabled={busy} onClick={() => void assistant.check()}>
                    {t("check")}
                  </Button>
                  {assistant.missing && (
                    <Button disabled={busy} onClick={() => void assistant.retryMissing()}>
                      {t("retry")}
                    </Button>
                  )}
                  {(!assistant.receipt || assistant.receipt.status === "dispatched") && (
                    <Button variant="ghost" onClick={() => void assistant.cancel()}>
                      {t("cancel")}
                    </Button>
                  )}
                </div>
              </div>
            )}
          {result?.status === "results" && (
            <section aria-label={t("proposal")} className="space-y-3">
              <h3 className="font-medium">{t("proposal")}</h3>
              <p className="text-xs text-muted-foreground">
                {t("scope", { count: result.matchedCount })}
              </p>
              <Conditions result={result} genreLabels={genreLabels} />
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => review(result)}>
                  {t("review")}
                </Button>
                <Button onClick={() => apply(result)}>{t("apply")}</Button>
              </div>
              {result.cards.length === 0 && <p className="text-sm">{t("empty")}</p>}
              {result.kind === "ips"
                ? result.cards.map((card) => (
                    <article key={card.id} className="space-y-2 rounded-xl bg-muted/25 p-3 text-sm">
                      <h4 className="font-medium wrap-anywhere">{card.title}</h4>
                      <p className="text-xs text-muted-foreground">{t("matches")}</p>
                      <p className="wrap-anywhere">
                        {card.locations.map((place) => place.label).join(" · ") ||
                          t("unknownPlace")}
                      </p>
                      {card.eras.map((era, index) => (
                        <p key={index}>
                          {era.startYear}–{era.endYear}
                        </p>
                      ))}
                      <p>
                        {card.episode?.durationSeconds != null
                          ? t("seconds", { seconds: card.episode.durationSeconds })
                          : t("unknownDuration")}
                      </p>
                      <Button variant="outline" onClick={() => apply(result, card.id)}>
                        {t("showOnMap")}
                      </Button>
                    </article>
                  ))
                : result.cards.map((card) => (
                    <article key={card.id} className="space-y-2 rounded-xl bg-muted/25 p-3 text-sm">
                      <h4 className="font-medium wrap-anywhere">{card.name}</h4>
                      <p>{t("services", { count: card.matchingServiceCount })}</p>
                      <p>
                        {card.basedIn
                          ? `${card.basedIn.city} · ${card.basedIn.countryCode}`
                          : t("unknownPlace")}
                      </p>
                      {card.remote && <p>{t("remote")}</p>}
                      <Button variant="outline" onClick={() => apply(result, card.id)}>
                        {t("showOnMap")}
                      </Button>
                    </article>
                  ))}
            </section>
          )}
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!currentValid || !assistant.canSend || !text.trim()) return;
              const submitted = text;
              void assistant.send(submitted).then((sent) => {
                if (sent) setText((value) => (value === submitted ? "" : value));
              });
            }}
          >
            {!currentValid && (
              <p role="alert" className="text-sm">
                {t("invalidConditions")}
              </p>
            )}
            <label className="block space-y-2 text-sm">
              <span>{t("prompt")}</span>
              <Textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={2000}
                rows={3}
                placeholder={t(current.kind === "ips" ? "ipExample" : "creatorExample")}
                disabled={busy}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={!currentValid || !assistant.canSend || !text.trim()}>
                {t("send")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={
                  busy ||
                  Boolean(
                    assistant.request &&
                    (!assistant.receipt || assistant.receipt.status === "dispatched")
                  )
                }
                onClick={() => {
                  assistant.reset();
                  setText("");
                }}
              >
                {t("newConversation")}
              </Button>
            </div>
          </form>
        </>
      )}
    </div>
  );
  return (
    <>
      <section aria-label={t("title")} className="hidden space-y-3 lg:block">
        <h2 className="font-semibold">{t("title")}</h2>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
        {body}
      </section>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            className={`fixed bottom-4 left-4 z-30 shadow-lg lg:hidden ${current.kind === "creators" ? "right-4" : "w-[calc(50%-1.5rem)]"}`}
          >
            {t("title")}
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto px-5 pb-8">
          <SheetHeader>
            <SheetTitle>{t("title")}</SheetTitle>
            <SheetDescription>{t("description")}</SheetDescription>
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
    </>
  );
}
function Conditions({
  result,
  genreLabels,
}: {
  result: Results;
  genreLabels: { code: string; label: string }[];
}) {
  const t = useTranslations("discoveryAssistant");
  const gps = useTranslations("contentGpsDiscovery");
  const service = useTranslations("creatorService");
  if (result.kind === "creators")
    return (
      <ul className="space-y-1 text-sm">
        {result.query.basedIn && (
          <li>
            {t("basedIn", {
              place: `${result.query.basedIn.city} · ${result.query.basedIn.countryCode}`,
            })}
          </li>
        )}
        {result.query.serves && (
          <li>
            {t("serves", {
              place: `${result.query.serves.city} · ${result.query.serves.countryCode}`,
            })}
          </li>
        )}
        {result.query.text && <li>{result.query.text}</li>}
        {result.query.category && <li>{service(`category.${result.query.category}`)}</li>}
        {result.query.remoteOnly && <li>{t("remote")}</li>}
        {result.query.availableForWork && <li>{t("available")}</li>}
      </ul>
    );
  const q = result.query;
  return (
    <ul className="space-y-1 text-sm wrap-anywhere">
      {q.location && (
        <li>
          {gps(q.location.kind === "story_setting" ? "storyPlaces" : "productionPlaces")} ·{" "}
          {gps(q.location.relation === "any" ? "anyPlace" : "allPlaces")}:{" "}
          {q.location.placeIds
            .map(
              (id) =>
                result.cards.flatMap((card) => card.locations).find((place) => place.placeId === id)
                  ?.label ?? t("selectedPlacesCount", { count: 1 })
            )
            .join(" · ")}
        </li>
      )}
      {q.era && (
        <li>
          {q.era.startYear}–{q.era.endYear} ·{" "}
          {gps(q.era.relation === "overlaps" ? "overlappingEra" : "containedEra")}
        </li>
      )}
      {q.duration && (
        <li>
          {t("maximumSeconds", { seconds: q.duration.maxSeconds })} ·{" "}
          {gps(q.duration.unknown === "exclude" ? "excludeUnknown" : "includeUnknown")}
        </li>
      )}
      {q.genreCodes.length > 0 && (
        <li>
          {gps("genre")}:{" "}
          {q.genreCodes
            .map(
              (code) =>
                genreLabels.find((genre) => genre.code === code)?.label ??
                t("genreCount", { count: 1 })
            )
            .join(" · ")}
        </li>
      )}
    </ul>
  );
}
