"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import type {
  CreatorDiscoveryRequest,
  CreatorDiscoveryResult,
} from "@repo/shared/creator-location";
import { SERVICE_CATEGORIES } from "@repo/shared/creator-service";
import { REGIONS, regionLabel } from "@repo/shared/regions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { UserAvatar } from "@/components/user-avatar";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";
import { encodeUserId } from "@/src/lib/user-id-codec";
import { ApiRequestError } from "@/src/lib/api";
import { useStudioDiscovery, useStudioOverview } from "../_hooks/use-studio-discovery";
import {
  EMPTY_STUDIO_QUERY,
  normalizeStudioQuery,
  studioDraftFromUrl,
  studioDraftFromQuery,
  studioQueryUrl,
  type StudioDiscoveryDraft,
} from "../_data/studio-discovery-query";

import { DiscoveryAssistant } from "../../ips/_components/discovery-assistant";
import { ContentGpsMap } from "../../ips/_components/content-gps-map";
import {
  readGpsMapConfig,
  type GpsMapConfig,
  type GpsMapFactory,
  type GpsViewport,
} from "../../ips/_data/content-gps-map-types";
import { studioMapFeatures } from "../_data/studio-map";

export function StudioDiscovery({ factory }: { factory?: GpsMapFactory } = {}) {
  const t = useTranslations("studioDiscovery");
  const locale = useLocale() as Locale;
  const params = useSearchParams();
  const router = useRouter();
  const client = useQueryClient();
  const { user, isLoading } = useCurrentUser();
  const viewerId = user ? String(user.id) : null;
  const draft = studioDraftFromUrl(new URLSearchParams(params.toString()));
  const normalized = normalizeStudioQuery(draft);
  const fingerprint = studioQueryUrl(draft);
  const path = localizePath("/creators/studios", locale);
  return (
    <main className="mx-auto min-h-screen max-w-screen-xl space-y-8 px-4 pt-8 pb-24 sm:px-6">
      <header className="space-y-3">
        <Link
          href={localizePath("/creators", locale)}
          className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground"
        >
          {t("allCreators")}
        </Link>
        <nav aria-label={t("modes")} className="flex gap-4 text-sm">
          <Link
            className="inline-flex min-h-11 items-center underline"
            href={localizePath("/ips/gps", locale)}
          >
            {t("ipMode")}
          </Link>
          <span className="inline-flex min-h-11 items-center font-semibold" aria-current="page">
            {t("creatorMode")}
          </span>
        </nav>
        <h1 className="text-2xl font-semibold">
          {normalized.success && normalized.data.islandOnly ? "FizzDragon Island" : t("title")}
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t(
            normalized.success && normalized.data.islandOnly ? "islandDescription" : "description"
          )}
        </p>
        {viewerId && !isLoading && (
          <Link
            href={localizePath("/profile/services", locale)}
            className="inline-flex min-h-11 items-center rounded-lg bg-muted px-4 text-sm font-medium hover:bg-muted/80"
          >
            {t("manageLocation")}
          </Link>
        )}
      </header>
      <StudioControls
        key={`${viewerId ?? "guest"}:${locale}`}
        viewerId={isLoading ? null : viewerId}
        initial={draft}
        submit={(next, selectedId) => {
          const search = studioQueryUrl(next);
          if (search === fingerprint)
            void client.invalidateQueries({
              predicate: (entry) =>
                ["creator-studio-search", "creator-studio-overview"].includes(
                  String(entry.queryKey[0])
                ) &&
                entry.queryKey[1] === viewerId &&
                entry.queryKey[2] === locale,
            });
          const nextParams = new URLSearchParams(search);
          if (selectedId) nextParams.set("selected", selectedId);
          router.push(`${path}${nextParams.size ? `?${nextParams}` : ""}`, { scroll: false });
        }}
      />
      {!normalized.success ? (
        <p role="alert" className="text-sm text-red-400">
          {t("invalid")}
        </p>
      ) : isLoading ? (
        <p role="status">{t("loading")}</p>
      ) : (
        <StudioResults
          key={`${viewerId ?? "guest"}:${locale}:${fingerprint}`}
          query={normalized.data}
          viewerId={viewerId}
          selection={params.get("selected")}
          setSelection={(id) => {
            const next = new URLSearchParams(params.toString());
            if (id) next.set("selected", id);
            else next.delete("selected");
            router.replace(`${path}${next.size ? `?${next}` : ""}`, { scroll: false });
          }}
          factory={factory}
        />
      )}
    </main>
  );
}

function StudioControls({
  initial,
  viewerId,
  submit,
}: {
  initial: StudioDiscoveryDraft;
  viewerId: string | null;
  submit: (draft: StudioDiscoveryDraft, selectedId?: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [source, setSource] = useState(studioQueryUrl(initial));
  const signature = studioQueryUrl(initial);
  if (source !== signature) {
    setSource(signature);
    setDraft(initial);
  }
  const form = useRef<HTMLDivElement>(null);
  const normalized = normalizeStudioQuery(draft);
  const applied = normalizeStudioQuery(initial);
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(230px,1fr)_minmax(0,2fr)]">
      <div className="contents lg:block lg:rounded-2xl lg:bg-muted/20 lg:p-5">
        {applied.success && (
          <DiscoveryAssistant
            viewerId={viewerId}
            currentValid={normalized.success}
            current={{
              kind: "creators",
              query: normalized.success ? normalized.data : applied.data,
            }}
            onProposal={(result) => {
              if (result.kind === "creators") setDraft(studioDraftFromQuery(result.query));
            }}
            onReview={(result) => {
              if (result.kind !== "creators") return;
              setDraft(studioDraftFromQuery(result.query));
              // Let the assistant Sheet close before moving focus to the form.
              requestAnimationFrame(() => {
                form.current?.scrollIntoView({ block: "start" });
                form.current?.querySelector("input")?.focus();
              });
            }}
            onApply={(result, id) => {
              if (result.kind === "creators") {
                const next = studioDraftFromQuery(result.query);
                setDraft(next);
                submit(next, id);
              }
            }}
          />
        )}
      </div>
      <div ref={form}>
        <SearchForm initial={initial} draft={draft} setDraft={setDraft} submit={submit} />
      </div>
    </div>
  );
}

function SearchForm({
  initial,
  draft,
  setDraft,
  submit,
}: {
  initial: StudioDiscoveryDraft;
  draft: StudioDiscoveryDraft;
  setDraft: (draft: StudioDiscoveryDraft) => void;
  submit: (draft: StudioDiscoveryDraft) => void;
}) {
  const t = useTranslations("studioDiscovery");
  const ts = useTranslations("creatorService");
  const [invalid, setInvalid] = useState(false);
  const change = (patch: Partial<StudioDiscoveryDraft>) => {
    setDraft({ ...draft, ...patch });
    setInvalid(false);
  };
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        const result = normalizeStudioQuery(draft);
        setInvalid(!result.success);
        if (result.success) submit(draft);
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <label className="min-w-0 space-y-2 text-sm">
          <span>{t("text")}</span>
          <Input
            className="min-h-11"
            maxLength={120}
            value={draft.text}
            onChange={(event) => change({ text: event.target.value })}
          />
        </label>
        <label className="min-w-0 space-y-2 text-sm">
          <span>{t("category")}</span>
          <NativeSelect
            className="min-h-11 w-full"
            aria-label={t("category")}
            value={draft.category}
            onChange={(category) => change({ category })}
          >
            <NativeSelectOption value="">{t("anyCategory")}</NativeSelectOption>
            {SERVICE_CATEGORIES.map((category) => (
              <NativeSelectOption key={category} value={category}>
                {ts(`category.${category}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <CityFilter
          title={t("basedIn")}
          country={draft.basedCountry}
          city={draft.basedCity}
          change={(country, city) => change({ basedCountry: country, basedCity: city })}
        />
        <CityFilter
          title={t("serves")}
          country={draft.servesCountry}
          city={draft.servesCity}
          change={(country, city) => change({ servesCountry: country, servesCity: city })}
        />
      </div>
      <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            className="size-5 accent-primary"
            checked={draft.remote === "1"}
            onChange={(event) => change({ remote: event.target.checked ? "1" : "" })}
          />
          {t("remoteOnly")}
        </label>
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            className="size-5 accent-primary"
            checked={draft.available === "1"}
            onChange={(event) => change({ available: event.target.checked ? "1" : "" })}
          />
          {t("availableOnly")}
        </label>
      </div>
      {studioQueryUrl(draft) !== studioQueryUrl(initial) && (
        <p className="text-sm text-muted-foreground">{t("applyHint")}</p>
      )}
      {invalid && (
        <p role="alert" className="text-sm text-red-400">
          {t("invalid")}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" className="min-h-11">
          {t(draft.location === "island" ? "searchCreators" : "search")}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => {
            setDraft(EMPTY_STUDIO_QUERY);
            setInvalid(false);
            submit(EMPTY_STUDIO_QUERY);
          }}
        >
          {t("reset")}
        </Button>
      </div>
    </form>
  );
}

function CityFilter({
  title,
  country,
  city,
  change,
}: {
  title: string;
  country: string;
  city: string;
  change: (country: string, city: string) => void;
}) {
  const t = useTranslations("studioDiscovery");
  const locale = useLocale() as Locale;
  return (
    <fieldset className="min-w-0 space-y-2 text-sm">
      <legend className="mb-2 font-medium">{title}</legend>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="min-w-0 space-y-2">
          <span>{t("country")}</span>
          <NativeSelect
            className="min-h-11 w-full"
            aria-label={`${title}: ${t("country")}`}
            value={country}
            onChange={(value) => change(value, city)}
          >
            <NativeSelectOption value="">{t("anyPlace")}</NativeSelectOption>
            {country && !REGIONS.some((region) => region.code === country) && (
              <NativeSelectOption value={country}>{country}</NativeSelectOption>
            )}
            {REGIONS.filter((region) => region.code !== "GLOBAL").map((region) => (
              <NativeSelectOption key={region.code} value={region.code}>
                {regionLabel(region.code, locale)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="min-w-0 space-y-2">
          <span>{t("city")}</span>
          <Input
            className="min-h-11"
            aria-label={`${title}: ${t("city")}`}
            maxLength={150}
            value={city}
            onChange={(event) => change(country, event.target.value)}
          />
        </label>
      </div>
      <Button
        type="button"
        variant="ghost"
        className="min-h-11"
        disabled={!country && !city}
        onClick={() => change("", "")}
      >
        {t("clearPlace", { place: title })}
      </Button>
    </fieldset>
  );
}

function StudioResults({
  query,
  viewerId,
  selection,
  setSelection,
  factory,
}: {
  query: CreatorDiscoveryRequest["query"];
  viewerId: string | null;
  selection: string | null;
  setSelection: (id: string | null) => void;
  factory?: GpsMapFactory;
}) {
  const t = useTranslations("studioDiscovery");
  const locale = useLocale() as Locale;
  const { open } = useAuthDialog();
  const router = useRouter();
  const islandHref = localizePath(
    `/creators/studios?${studioQueryUrl({ ...studioDraftFromQuery(query), location: "island", basedCountry: "", basedCity: "" })}`,
    locale
  );
  const state = useStudioDiscovery(query, viewerId, locale);
  const client = useQueryClient();
  const [configuration] = useState<{ config: GpsMapConfig | null; error: boolean }>(() => {
    try {
      return { config: readGpsMapConfig(), error: false };
    } catch {
      return { config: null, error: true };
    }
  });
  const [viewport, setViewport] = useState<GpsViewport>({
    coordinateSystem: configuration.config?.provider === "gaode" ? "GCJ02" : "WGS84",
    west: -180,
    east: 180,
    south: -80,
    north: 80,
  });
  const overview = useStudioOverview(query, viewerId, locale, viewport, selection);
  const agrees =
    !overview.data ||
    !state.data ||
    state.data.pages.every((page) => page.queryId === overview.data.queryId);
  const countsAgree =
    !overview.data ||
    !state.data ||
    (state.data.pages.at(-1)?.matchedCount === overview.data.matchedCount &&
      state.data.pages.at(-1)?.accessibleCount === overview.data.accessibleCount);
  const mapReady =
    Boolean(state.data) &&
    countsAgree &&
    agrees &&
    !overview.isFetching &&
    !overview.isError &&
    !state.isRefetching &&
    !state.isError;
  const mapData = mapReady ? overview.data : undefined;
  useEffect(() => {
    if (
      !selection ||
      !overview.data ||
      overview.isFetching ||
      overview.isError ||
      overview.data.selected
    )
      return;
    const queryKey = ["creator-studio-search", viewerId, locale, query];
    void client.cancelQueries({ queryKey, exact: true }).then(() =>
      client.setQueryData<InfiniteData<CreatorDiscoveryResult>>(
        queryKey,
        (previous) =>
          previous && {
            ...previous,
            pages: previous.pages.map((page) => ({
              ...page,
              items: page.items.filter((item) => item.id !== selection),
            })),
          }
      )
    );
  }, [
    selection,
    overview.data,
    overview.isFetching,
    overview.isError,
    viewerId,
    locale,
    query,
    client,
  ]);
  const denied =
    state.error instanceof ApiRequestError && [401, 403, 404].includes(state.error.status);
  const hide =
    state.isLoading ||
    (state.isFetching && !state.isFetchingNextPage) ||
    (state.isError && (!state.isFetchNextPageError || denied));
  const pages = hide || !agrees ? [] : (state.data?.pages ?? []);
  const current = pages.at(-1);
  const items = [
    ...new Map(pages.flatMap((page) => page.items).map((item) => [item.id, item])).values(),
  ];
  return (
    <section aria-label={t("results")} className="space-y-5" aria-busy={state.isFetching}>
      {state.isError && (
        <div className="space-y-3">
          <p role="alert" className="break-words text-sm text-red-400">
            {state.error.message}
          </p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={state.isFetching}
            onClick={() =>
              void (state.isFetchNextPageError && !denied ? state.fetchNextPage() : state.refetch())
            }
          >
            {t("retry")}
          </Button>
        </div>
      )}
      {state.isFetching && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("loading")}
        </p>
      )}
      {current && !state.isError && (
        <p role="status" className="text-sm text-muted-foreground">
          {t(query.islandOnly ? "islandCount" : "count", { count: current.matchedCount })}
        </p>
      )}
      {!countsAgree && (
        <div className="space-y-2">
          <p role="status">{t("resultsChanged")}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void state.refetch();
              void overview.refetch();
            }}
          >
            {t("retryMap")}
          </Button>
        </div>
      )}
      {configuration.error && <p role="alert">{t("mapConfiguration")}</p>}
      {overview.isError && (
        <div className="space-y-2">
          <p role="alert" className="break-words">
            {overview.error.message}
          </p>
          <Button type="button" variant="outline" onClick={() => void overview.refetch()}>
            {t("retryMap")}
          </Button>
        </div>
      )}
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(250px,1fr)]">
        <div className="min-w-0">
          <div className="relative">
            <ContentGpsMap
              kind="creator"
              config={configuration.config}
              initialViewport={viewport}
              features={
                mapData
                  ? studioMapFeatures(
                      mapData,
                      (count, matched) => t(matched ? "matchedPins" : "otherPins", { count }),
                      `FizzDragon Island · ${t("islandDescription")}`
                    )
                  : []
              }
              loading={!mapReady}
              onViewport={setViewport}
              onSelect={setSelection}
              onVirtualSelect={(destination) => {
                if (destination === "fizzdragon-island") router.push(islandHref, { scroll: false });
              }}
              factory={factory}
            />
            {mapData && (
              <Link
                href={localizePath(
                  `/creators/studios?${studioQueryUrl({ ...studioDraftFromQuery(query), location: query.islandOnly ? "" : "island", basedCountry: "", basedCity: "" })}`,
                  locale
                )}
                className="mt-3 flex w-fit max-w-full items-center gap-3 rounded-xl bg-card p-3 text-foreground hover:bg-muted"
                aria-label={t(query.islandOnly ? "islandLeave" : "islandBrowse")}
              >
                <svg
                  viewBox="0 0 64 64"
                  className="size-12 shrink-0 text-primary"
                  aria-hidden="true"
                >
                  <path
                    d="M8 48 Q16 36 31 38 Q48 34 57 48 Q43 58 24 54 Z"
                    fill="currentColor"
                    opacity=".2"
                  />
                  <path
                    d="M28 44 Q37 27 32 17 M32 19 Q17 7 12 25 Q24 18 32 19 M32 19 Q43 7 53 23 Q43 18 32 19 M7 57 Q15 61 23 57 Q31 53 39 57 Q47 61 57 57"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="min-w-0 space-y-1">
                  <span className="block text-sm font-semibold">FizzDragon Island</span>
                  <span className="block text-xs text-muted-foreground">
                    {t("islandDescription")}
                  </span>
                  <span className="block text-xs">
                    {t(query.islandOnly ? "islandLeave" : "islandCount", {
                      count: mapData.island.matchedCreatorCount,
                    })}
                  </span>
                </span>
              </Link>
            )}
          </div>
          {mapData?.map && (
            <p className="mt-3 text-xs text-muted-foreground">
              {t("mapCount", {
                count: mapData.map.creatorCount,
                matched: mapData.map.matchedCreatorCount,
              })}
            </p>
          )}
        </div>
        <aside
          aria-label={t(query.islandOnly ? "selectedCreator" : "selection")}
          className="min-w-0 space-y-3 rounded-xl bg-muted/20 p-4"
        >
          <h2 className="font-semibold">{t(query.islandOnly ? "selectedCreator" : "selection")}</h2>
          {!selection ? (
            <p>{t(query.islandOnly ? "creatorSelectHint" : "selectHint")}</p>
          ) : !mapReady ? (
            <p role="status">{t("loading")}</p>
          ) : mapData?.selected ? (
            <StudioCard studio={mapData.selected} />
          ) : (
            <p>{t("selectionUnavailable")}</p>
          )}
          {selection && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => setSelection(null)}
            >
              {t("clearSelection")}
            </Button>
          )}
        </aside>
      </div>
      {current && items.length === 0 && <p>{t(query.islandOnly ? "islandEmpty" : "empty")}</p>}
      <div className="grid gap-5 min-[480px]:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <StudioCard
            key={item.id}
            studio={item}
            onSelect={() => setSelection(item.id)}
            selected={mapData?.selected?.id === item.id}
          />
        ))}
      </div>
      {state.hasNextPage && !hide && !state.isError && (
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={state.isFetching}
          onClick={() => void state.fetchNextPage()}
        >
          {t("more")}
        </Button>
      )}
      {current?.requiresLogin && !viewerId && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("guestLimit")}</p>
          <Button type="button" className="min-h-11" onClick={() => open()}>
            {t("login")}
          </Button>
        </div>
      )}
    </section>
  );
}

function StudioCard({
  studio,
  onSelect,
  selected = false,
}: {
  studio: CreatorDiscoveryResult["items"][number];
  onSelect?: () => void;
  selected?: boolean;
}) {
  const t = useTranslations("studioDiscovery");
  const locale = useLocale() as Locale;
  const place = (value: NonNullable<typeof studio.basedIn>) =>
    `${value.city}, ${regionLabel(value.countryCode, locale)}`;
  const profile = localizePath(`/creators/${encodeUserId(studio.id)}`, locale);
  return (
    <article className="min-w-0 space-y-4 rounded-xl bg-white/[0.04] p-5">
      <Link
        href={profile}
        prefetch={false}
        className="flex min-h-11 min-w-0 items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-primary"
      >
        <UserAvatar
          src={studio.avatarUrl}
          seed={studio.id}
          name={studio.name}
          className="size-12 shrink-0"
        />
        <h2 className="break-words text-base font-semibold">{studio.name}</h2>
      </Link>
      {onSelect && (
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          aria-pressed={selected}
          onClick={onSelect}
        >
          {t(
            studio.serviceCount === 0
              ? selected
                ? "selectedCreator"
                : "selectCreator"
              : selected
                ? "selectedStudio"
                : "selectStudio"
          )}
        </Button>
      )}
      {!studio.point && <p className="text-xs text-muted-foreground">{t("unpinned")}</p>}
      <dl className="space-y-2 text-sm">
        {studio.showOnMap && studio.basedIn && (
          <div>
            <dt className="text-muted-foreground">{t("basedIn")}</dt>
            <dd className="break-words">{place(studio.basedIn)}</dd>
          </div>
        )}
        {studio.serves.length > 0 && (
          <div>
            <dt className="text-muted-foreground">{t("serves")}</dt>
            <dd className="break-words">{studio.serves.map(place).join(" · ")}</dd>
          </div>
        )}
      </dl>
      <div className="space-y-1 text-sm text-muted-foreground">
        {studio.remote && <p>{t("remote")}</p>}
        {studio.openToWork && <p>{t("available")}</p>}
        {studio.serviceCount > 0 && <p>{t("services", { count: studio.matchingServiceCount })}</p>}
      </div>
      <Link
        href={studio.serviceCount > 0 ? `${profile}#services` : profile}
        prefetch={false}
        className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
      >
        {t(studio.serviceCount > 0 ? "viewStudio" : "viewCreator")}
      </Link>
    </article>
  );
}
