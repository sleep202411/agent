"use client";
import { useEffect, useState } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ContentGpsSearchRequestSchema,
  type ContentGpsQuery,
  type ContentGpsSearchResult,
} from "@repo/shared/content-gps";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { useContentGpsCollection } from "../_hooks/use-content-gps-collection";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";
import { tvEntryPath } from "@/app/tv/_data/tv-entry";
import { ipRoomPath } from "@/src/lib/ip-commerce/urls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  useContentGpsCards,
  useContentGpsOverview,
  useContentGpsGenres,
  gpsResponsesAgree,
} from "../_hooks/use-content-gps-search";
import {
  EMPTY_GPS_DRAFT,
  gpsDraftFromUrl,
  gpsDraftUrl,
  normalizeGpsDraft,
  gpsMapFeatures,
  type GpsSearchDraft,
} from "../_data/content-gps-discovery";
import {
  readGpsMapConfig,
  type GpsMapConfig,
  type GpsMapFactory,
  type GpsViewport,
} from "../_data/content-gps-map-types";
import { IpContributingStudios } from "./ip-contributing-studios";
import { ContentGpsMap } from "./content-gps-map";
import { ContentGpsEraFilter } from "./content-gps-era-filter";
import { ContentGpsPlazaCard } from "./ip-plaza-card";

export function ContentGpsDiscovery() {
  const t = useTranslations("contentGpsDiscovery");
  const locale = useLocale() as Locale;
  const params = useSearchParams();
  const router = useRouter();
  const { user, isLoading } = useCurrentUser();
  const draft = gpsDraftFromUrl(new URLSearchParams(params.toString()));
  const normalized = normalizeGpsDraft(draft, locale);
  const selection = ContentGpsSearchRequestSchema.shape.selectedIpId.safeParse(
    params.get("selected")
  );
  const [config] = useState(() => {
    try {
      return { value: readGpsMapConfig(), error: false };
    } catch {
      return { value: null, error: true };
    }
  });
  return (
    <main className="mx-auto min-h-screen max-w-[1800px] space-y-6 px-4 py-6 pb-24 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Link
          className="inline-flex min-h-11 items-center text-sm hover:underline"
          href={localizePath("/ips", locale)}
        >
          {t("catalogue")}
        </Link>
      </header>
      <nav aria-label={t("modes")} className="flex gap-4 text-sm">
        <span className="inline-flex min-h-11 items-center font-semibold" aria-current="page">
          {t("ipMode")}
        </span>
        <Link
          className="inline-flex min-h-11 items-center underline"
          href={localizePath("/creators/studios", locale)}
        >
          {t("creatorMode")}
        </Link>
      </nav>
      {config.error && <p role="alert">{t("mapConfiguration")}</p>}
      {!normalized.success || !selection.success ? (
        <div role="alert">
          <p>{t("invalid")}</p>
          <Button onClick={() => router.replace(localizePath("/ips/gps", locale))}>
            {t("reset")}
          </Button>
        </div>
      ) : isLoading ? (
        <p role="status">{t("loading")}</p>
      ) : (
        <ContentGpsResults
          key={`${user?.id ?? "guest"}:${locale}`}
          query={normalized.data}
          initialDraft={draft}
          viewerId={user ? String(user.id) : null}
          config={config.value}
          selectedIpId={selection.data}
          onSelectionChange={(id) => {
            const next = new URLSearchParams(params.toString());
            if (id) next.set("selected", id);
            else next.delete("selected");
            router.replace(`${localizePath("/ips/gps", locale)}${next.size ? `?${next}` : ""}`, {
              scroll: false,
            });
          }}
          onApply={(next, selectedId) => {
            const searchParams = new URLSearchParams(gpsDraftUrl(next));
            if (selectedId) searchParams.set("selected", selectedId);
            const search = searchParams.toString();
            router.push(`${localizePath("/ips/gps", locale)}${search ? `?${search}` : ""}`, {
              scroll: false,
            });
          }}
        />
      )}
    </main>
  );
}

export function ContentGpsResults({
  query,
  initialDraft,
  viewerId,
  config,
  onApply,
  factory,
  selectedIpId,
  onSelectionChange,
}: {
  query: ContentGpsQuery;
  initialDraft: GpsSearchDraft;
  viewerId: string | null;
  config: GpsMapConfig | null;
  onApply: (draft: GpsSearchDraft, selectedId?: string) => void;
  factory?: GpsMapFactory;
  selectedIpId?: string | null;
  onSelectionChange?: (id: string | null) => void;
}) {
  const t = useTranslations("contentGpsDiscovery");
  const locale = useLocale() as Locale;
  const [draft, setDraft] = useState(initialDraft);
  const [sourceSignature, setSourceSignature] = useState(gpsDraftUrl(initialDraft));
  const nextSignature = gpsDraftUrl(initialDraft);
  if (sourceSignature !== nextSignature) {
    setSourceSignature(nextSignature);
    setDraft(initialDraft);
  }
  const [localSelection, setLocalSelection] = useState<string | null>(null);
  const selected = selectedIpId === undefined ? localSelection : selectedIpId;
  const setSelected = onSelectionChange ?? setLocalSelection;
  const auth = useAuthDialog();
  const collection = useContentGpsCollection(viewerId, locale, selected);
  const [drawer, setDrawer] = useState(false);
  const [placeSearch, setPlaceSearch] = useState("");
  const [viewport, setViewport] = useState<GpsViewport>({
    coordinateSystem: config?.provider === "gaode" ? "GCJ02" : "WGS84",
    west: -180,
    east: 180,
    south: -80,
    north: 80,
  });
  const cards = useContentGpsCards(
    query,
    viewerId,
    viewport.coordinateSystem,
    t("responseMismatch")
  );
  const overview = useContentGpsOverview(
    query,
    viewerId,
    viewport,
    selected,
    placeSearch,
    t("responseMismatch")
  );
  const queryClient = useQueryClient();
  useEffect(() => {
    if (
      !selected ||
      !overview.data ||
      overview.isFetching ||
      overview.isError ||
      overview.data.selected
    )
      return;
    const queryKey = ["content-gps-cards", viewerId, query, viewport.coordinateSystem];
    // A definitive denied selection also invalidates any earlier list snapshot.
    // Cancel in-flight pages before removing the card so a late reply cannot restore it.
    void queryClient.cancelQueries({ queryKey, exact: true }).then(() => {
      queryClient.setQueryData<InfiniteData<ContentGpsSearchResult>>(
        queryKey,
        (previous) =>
          previous && {
            ...previous,
            pages: previous.pages.map((page) => ({
              ...page,
              items: page.items.filter((item) => item.id !== selected),
            })),
          }
      );
    });
  }, [
    selected,
    overview.data,
    overview.isFetching,
    overview.isError,
    queryClient,
    viewerId,
    query,
    viewport.coordinateSystem,
  ]);
  const genres = useContentGpsGenres(locale);
  const agreement = gpsResponsesAgree(cards.data?.pages, overview.data);
  // Background failures cannot leave an old result's matching assertions visible.
  const ready =
    agreement && !cards.isError && !overview.isError && !cards.isRefetching && !overview.isFetching;
  const data = ready ? overview.data : undefined;
  const items =
    cards.isError || cards.isRefetching || (overview.data && !agreement)
      ? []
      : (cards.data?.pages.flatMap((page) => page.items) ?? []).filter(
          (item) => !(ready && selected === item.id && !data?.selected)
        );
  const normalized = normalizeGpsDraft(draft, locale);
  const dirty = gpsDraftUrl(draft) !== gpsDraftUrl(initialDraft);
  const retry = () => {
    void cards.refetch();
    void overview.refetch();
  };
  const form = (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!normalized.success) return;
        setDrawer(false);
        if (!dirty) retry();
        else onApply(draft);
      }}
    >
      <h2 className="hidden text-base font-semibold lg:block">{t("conditions")}</h2>
      <label className="block space-y-2 text-sm">
        <span>{t("locationKind")}</span>
        <NativeSelect
          value={draft.locationKind ?? "story_setting"}
          onChange={(value) => setDraft({ ...draft, locationKind: value, places: [] })}
        >
          <NativeSelectOption value="story_setting">{t("storyPlaces")}</NativeSelectOption>
          <NativeSelectOption value="production_origin">{t("productionPlaces")}</NativeSelectOption>
        </NativeSelect>
      </label>
      <label className="block space-y-2 text-sm">
        <span>{t("locationRelation")}</span>
        <NativeSelect
          value={draft.locationRelation ?? "any"}
          onChange={(value) => setDraft({ ...draft, locationRelation: value })}
        >
          <NativeSelectOption value="any">{t("anyPlace")}</NativeSelectOption>
          <NativeSelectOption value="all">{t("allPlaces")}</NativeSelectOption>
        </NativeSelect>
      </label>
      <label className="block space-y-2 text-sm">
        <span>{t("findPlace")}</span>
        <Input
          value={placeSearch}
          maxLength={100}
          onChange={(event) => setPlaceSearch(event.target.value)}
        />
      </label>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm">
          {t(draft.locationKind === "production_origin" ? "productionPlaces" : "storyPlaces")}
        </legend>
        <div className="max-h-44 overflow-y-auto">
          {[
            ...new Map([
              ...(
                data?.places.filter(
                  (place) => place.kind === (draft.locationKind ?? "story_setting")
                ) ?? []
              ).map((place) => [place.id, place.label] as const),
              ...draft.places
                .filter((id) => !data?.places.some((place) => place.id === id))
                .map((id) => [id, id.replace(/^label:/, "")] as const),
            ]).entries(),
          ].map(([id, label]) => (
            <label key={id} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.places.includes(id)}
                disabled={!draft.places.includes(id) && draft.places.length >= 8}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    places: event.target.checked
                      ? [...draft.places, id]
                      : draft.places.filter((value) => value !== id),
                  })
                }
              />
              {label}
            </label>
          ))}
        </div>
        {data?.placesTruncated && (
          <p className="text-xs text-muted-foreground">{t("refinePlaces")}</p>
        )}
      </fieldset>
      <label className="block space-y-2 text-sm">
        <span>{t("genre")}</span>
        <NativeSelect
          value=""
          onChange={(value) => {
            if (value && draft.genres.length < 8 && !draft.genres.includes(value))
              setDraft({ ...draft, genres: [...draft.genres, value] });
          }}
          disabled={draft.genres.length >= 8}
        >
          <NativeSelectOption value="" disabled>
            {t("addGenre")}
          </NativeSelectOption>
          {genres.data?.items
            .filter((genre) => !draft.genres.includes(genre.code))
            .map((genre) => (
              <NativeSelectOption key={genre.code} value={genre.code}>
                {genre.label}
              </NativeSelectOption>
            ))}
        </NativeSelect>
      </label>
      <div className="flex flex-wrap gap-2">
        {draft.genres.length === 0 && (
          <span className="text-xs text-muted-foreground">{t("allGenres")}</span>
        )}
        {draft.genres.map((code) => {
          const label = genres.data?.items.find((genre) => genre.code === code)?.label ?? code;
          return (
            <Button
              key={code}
              type="button"
              variant="soft"
              aria-label={t("removeGenre", { genre: label })}
              onClick={() =>
                setDraft({ ...draft, genres: draft.genres.filter((value) => value !== code) })
              }
            >
              {label} ×
            </Button>
          );
        })}
      </div>
      {genres.isError && (
        <p role="alert" className="text-xs">
          {genres.error.message}
          <button
            type="button"
            className="ml-2 min-h-11 underline"
            onClick={() => void genres.refetch()}
          >
            {t("retry")}
          </button>
        </p>
      )}
      <fieldset>
        <legend className="mb-2 text-sm">{t("storyEra")}</legend>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 text-xs">
            {t("fromYear")}
            <Input
              inputMode="numeric"
              value={draft.startYear}
              onChange={(event) => setDraft({ ...draft, startYear: event.target.value })}
            />
          </label>
          <label className="space-y-1 text-xs">
            {t("toYear")}
            <Input
              inputMode="numeric"
              value={draft.endYear}
              onChange={(event) => setDraft({ ...draft, endYear: event.target.value })}
            />
          </label>
        </div>
      </fieldset>
      <label className="block space-y-2 text-sm">
        <span>{t("eraRelation")}</span>
        <NativeSelect
          value={draft.eraRelation ?? "overlaps"}
          onChange={(value) => setDraft({ ...draft, eraRelation: value })}
        >
          <NativeSelectOption value="overlaps">{t("overlappingEra")}</NativeSelectOption>
          <NativeSelectOption value="contained">{t("containedEra")}</NativeSelectOption>
        </NativeSelect>
      </label>
      <label className="block space-y-2 text-sm">
        <span>{t("unknownDuration")}</span>
        <NativeSelect
          value={draft.unknownDuration ?? "exclude"}
          onChange={(value) => setDraft({ ...draft, unknownDuration: value })}
        >
          <NativeSelectOption value="exclude">{t("excludeUnknown")}</NativeSelectOption>
          <NativeSelectOption value="include_labelled">{t("includeUnknown")}</NativeSelectOption>
        </NativeSelect>
      </label>
      {(draft.durationUnit === "film" || Boolean(draft.moods?.length)) && (
        <p role="alert" className="text-sm">
          {t("unsupportedConditions")}
        </p>
      )}
      <label className="block space-y-2 text-sm">
        <span>{t("maxSeconds")}</span>
        <Input
          inputMode="numeric"
          value={draft.maxSeconds}
          onChange={(event) => setDraft({ ...draft, maxSeconds: event.target.value })}
        />
        <span className="block text-xs text-muted-foreground">
          {t(
            draft.unknownDuration === "include_labelled"
              ? "durationPolicyInclude"
              : "durationPolicy"
          )}
        </span>
      </label>
      {!normalized.success && (
        <p role="alert" className="text-sm">
          {t("invalid")}
        </p>
      )}
      {dirty && <p className="text-xs text-muted-foreground">{t("unapplied")}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={!normalized.success}>
          {t("search")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setDraft(EMPTY_GPS_DRAFT);
            setSelected(null);
            setDrawer(false);
            if (gpsDraftUrl(initialDraft)) onApply(EMPTY_GPS_DRAFT);
            else retry();
          }}
        >
          {t("reset")}
        </Button>
      </div>
    </form>
  );
  const failure = cards.error ?? overview.error;
  return (
    <>
      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetTrigger asChild>
          <Button className="fixed bottom-4 right-4 z-30 min-h-11 shadow-lg lg:static">
            {t("conditions")}
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto px-5 pb-8">
          <SheetHeader>
            <SheetTitle>{t("conditions")}</SheetTitle>
            <SheetDescription>{t("description")}</SheetDescription>
          </SheetHeader>
          {form}
        </SheetContent>
      </Sheet>
      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <div className="min-w-0">
          <ContentGpsMap
            config={config}
            initialViewport={viewport}
            features={
              data
                ? gpsMapFeatures(data, (count, matched) =>
                    t(matched ? "matchedPins" : "otherPins", { count })
                  )
                : []
            }
            loading={!ready}
            onViewport={setViewport}
            onSelect={setSelected}
            factory={factory}
          />
          {normalized.success && normalized.data.era && (
            <ContentGpsEraFilter
              startYear={normalized.data.era.startYear}
              endYear={normalized.data.era.endYear}
              onChange={(start, end) =>
                setDraft({ ...draft, startYear: String(start), endYear: String(end) })
              }
            />
          )}
          {data && (
            <p className="mt-3 text-xs text-muted-foreground">
              {t("mapCount", { matched: data.mapMatchedIpCount, count: data.mapIpCount })}
            </p>
          )}
        </div>
        <aside
          className="min-w-0 space-y-5 rounded-2xl bg-muted/20 p-5 lg:max-h-[75vh] lg:overflow-y-auto"
          aria-label={t("results")}
        >
          {failure ? (
            <div role="alert" className="space-y-2">
              <p>{failure.message}</p>
              <Button onClick={retry}>{t("retry")}</Button>
            </div>
          ) : cards.isPending || overview.isPending ? (
            <p role="status">{t("loading")}</p>
          ) : (
            !agreement && (
              <div role="alert">
                <p>{t("responseMismatch")}</p>
                <Button onClick={retry}>{t("retry")}</Button>
              </div>
            )
          )}
          <section aria-label={t("results")} className="space-y-4">
            <h2 className="text-lg font-semibold">{t("results")}</h2>
            {data && (
              <p className="text-sm text-muted-foreground">
                {t("count", { matched: data.matchedCount, count: data.accessibleCount })}
              </p>
            )}
            {ready && items.length === 0 && <p>{t("empty")}</p>}
            {/* A map refresh does not blank usable list cards; match counts and pins wait for agreement. */}
            <div className="grid grid-cols-1 gap-3">
              {items.map((item) => (
                <ContentGpsPlazaCard
                  key={item.id}
                  item={item}
                  compact
                  selected={ready && data?.selected?.id === item.id}
                  onSelect={() => setSelected(item.id)}
                />
              ))}
            </div>
            {cards.hasNextPage && (
              <Button disabled={cards.isFetching} onClick={() => void cards.fetchNextPage()}>
                {cards.isFetchingNextPage ? t("loading") : t("more")}
              </Button>
            )}
          </section>
          <section className="min-w-0 space-y-3" aria-label={t("selection")}>
            <h2 className="font-semibold">{t("selection")}</h2>
            {selected ? (
              !ready ? (
                <p role="status">{t("loading")}</p>
              ) : data?.selected ? (
                <>
                  <SelectedResult item={data.selected} />
                  <IpContributingStudios
                    key={`${data.selected.id}:${viewerId ?? "guest"}:${locale}`}
                    ipId={data.selected.id}
                    viewerId={viewerId}
                  />
                  <Button
                    disabled={
                      Boolean(viewerId) &&
                      (collection.busy ||
                        collection.query.isPending ||
                        collection.query.isFetching ||
                        collection.query.isError)
                    }
                    onClick={() =>
                      viewerId ? void collection.toggle(data.selected!.id) : auth.open()
                    }
                  >
                    {collection.busy
                      ? t("saving")
                      : collection.saved(data.selected.id)
                        ? t("removeBookmark")
                        : t("bookmark")}
                  </Button>
                  {(collection.error || collection.query.error) && (
                    <p role="alert" className="text-sm">
                      {(collection.error ?? collection.query.error)?.message}
                    </p>
                  )}
                  {collection.query.isError && (
                    <Button variant="ghost" onClick={() => void collection.query.refetch()}>
                      {t("retry")}
                    </Button>
                  )}
                </>
              ) : (
                <p>{t("selectionUnavailable")}</p>
              )
            ) : (
              <p className="text-sm text-muted-foreground">{t("selectHint")}</p>
            )}
            {selected && (
              <Button variant="ghost" onClick={() => setSelected(null)}>
                {t("clearSelection")}
              </Button>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

function SelectedResult({ item }: { item: ContentGpsSearchResult["items"][number] }) {
  const t = useTranslations("contentGpsDiscovery");
  const locale = useLocale() as Locale;
  return (
    <div className="space-y-3 text-sm">
      <h3 className="font-semibold">{item.title}</h3>
      <p>{item.matched ? `✓ ${t("matches")}` : `○ ${t("outsideQuery")}`}</p>
      <p className="text-muted-foreground">
        {item.locations.map((location) => location.label).join(" · ") || t("unknownLocation")}
      </p>
      {item.eras.map((era, index) => (
        <p key={index}>
          {era.startYear}–{era.endYear}
        </p>
      ))}
      <p>
        {item.episode?.durationSeconds != null
          ? t("episodeSeconds", { count: item.episode.durationSeconds })
          : t("unknownDuration")}
      </p>
      <Link
        href={localizePath(tvEntryPath(item.id, item.episode?.id), locale)}
        className="inline-flex min-h-11 items-center underline"
      >
        {t("openTv")}
      </Link>
      <Link
        href={localizePath(ipRoomPath(item.roomNumber), locale)}
        className="inline-flex min-h-11 items-center underline"
      >
        {t("details")}
      </Link>
    </div>
  );
}
