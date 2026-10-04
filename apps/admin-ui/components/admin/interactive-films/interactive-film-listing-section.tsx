/* eslint-disable @next/next/no-img-element -- Review frozen creator media with its original aspect ratio. */
"use client";

import { useCallback, useEffect, useState } from "react";
import { IconLoader2, IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { requestAdminInteractiveFilmListing } from "@/lib/interactive-film-listing-client";
import type { AdminInteractiveFilmDetail } from "@/lib/interactive-film-admin-contract";
import {
  areInteractiveFilmMaterialsReady,
  interactiveFilmListingVersion,
  type AdminInteractiveFilmListingLoadResult,
  type AdminInteractiveFilmListingSnapshot,
} from "@/lib/interactive-film-listing-contract";
import { InteractiveFilmErrorBanner } from "./shared";

type ListingState = {
  refreshRevision: number;
  gameId: string;
  contentVersion: string | null;
  data: AdminInteractiveFilmListingSnapshot | null;
  error: string | null;
  loading: boolean;
};

export function InteractiveFilmListingSection({
  game,
  initialListing,
  onReadyChange,
  refreshRevision,
}: {
  game: AdminInteractiveFilmDetail;
  initialListing: AdminInteractiveFilmListingLoadResult;
  onReadyChange: (contentVersion: string | null, ready: boolean) => void;
  refreshRevision: number;
}) {
  const contentVersion = interactiveFilmListingVersion(game);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<ListingState>(() => ({
    gameId: game.gameId,
    refreshRevision: 0,
    ...initialListing,
    loading: false,
  }));
  const current =
    state.gameId === game.gameId &&
    state.contentVersion === contentVersion &&
    state.refreshRevision === refreshRevision;
  const loading = Boolean(contentVersion && (!current || state.loading));
  const data = current && !loading ? state.data : null;
  const error = current && !loading ? state.error : null;
  const listing = data?.listing ?? null;
  const coverKey = JSON.stringify([
    game.gameId,
    contentVersion,
    listing?.coverUrl,
    retry,
    refreshRevision,
  ]);
  const [cover, setCover] = useState<{ key: string; ready: boolean } | null>(null);
  const coverReady = cover?.key === coverKey && cover.ready;
  const onCoverReadyChange = useCallback(
    (ready: boolean) => {
      setCover({ key: coverKey, ready });
      // Notify synchronously so a preflight finishing in this event cannot
      // submit after the reviewer has lost access to the required cover.
      onReadyChange(
        contentVersion,
        Boolean(ready && areInteractiveFilmMaterialsReady(data) && !error && !loading)
      );
    },
    [coverKey, contentVersion, data, error, loading, onReadyChange]
  );
  useEffect(() => {
    onReadyChange(
      contentVersion,
      Boolean(
        contentVersion &&
        areInteractiveFilmMaterialsReady(data) &&
        !error &&
        !loading &&
        (data?.listing === null || coverReady)
      )
    );
  }, [contentVersion, data, error, loading, coverReady, onReadyChange]);

  useEffect(() => {
    if (!contentVersion) return;
    if (
      retry === 0 &&
      refreshRevision === 0 &&
      state.gameId === game.gameId &&
      state.contentVersion === contentVersion
    )
      return;
    const controller = new AbortController();
    const gameId = game.gameId;
    async function load() {
      try {
        const next = await requestAdminInteractiveFilmListing(
          gameId,
          contentVersion!,
          controller.signal
        );
        if (!controller.signal.aborted) {
          setState({
            gameId,
            contentVersion,
            refreshRevision,
            data: next,
            error: null,
            loading: false,
          });
        }
      } catch (reason) {
        if (!controller.signal.aborted) {
          setState({
            gameId,
            refreshRevision,
            contentVersion,
            data: null,
            error:
              reason instanceof Error
                ? reason.message
                : "Promotional materials could not be loaded.",
            loading: false,
          });
        }
      }
    }
    void load();
    return () => controller.abort();
    // The response state must not restart its own request; retry/version changes own the read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.gameId, contentVersion, retry, refreshRevision]);

  function retryMaterials() {
    setState({
      gameId: game.gameId,
      contentVersion,
      refreshRevision,
      data: null,
      error: null,
      loading: true,
    });
    setRetry((value) => value + 1);
  }
  return (
    <section className="space-y-4 border-y border-slate-200 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-950">Promotional materials</h2>
          <p className="mt-1 text-[12px] text-slate-500">
            {game.status === "published" || (game.status === "offline" && game.currentVersion)
              ? "Published release snapshot"
              : "Submitted release snapshot"}
          </p>
        </div>
        {contentVersion ? (
          <code className="max-w-full break-all text-[11px] text-slate-500">{contentVersion}</code>
        ) : null}
      </div>
      {!contentVersion ? (
        <p className="text-[12px] text-slate-500">No release version is available.</p>
      ) : loading ? (
        <p role="status" className="flex items-center gap-2 text-[12px] text-slate-500">
          <IconLoader2 className="size-4 animate-spin" />
          Loading release materials…
        </p>
      ) : error ? (
        <div className="space-y-3">
          <InteractiveFilmErrorBanner message={error} />
          <Button variant="outline" size="sm" onClick={retryMaterials}>
            <IconRefresh className="size-3.5" />
            Retry materials
          </Button>
        </div>
      ) : !listing ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-800">
          This release has no promotional materials snapshot. Existing Java metadata and the
          Manifest remain available for review.
        </p>
      ) : (
        <div className="space-y-5">
          {!listing.coverUrl ? (
            <div className="space-y-2">
              <p
                role="alert"
                className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-800"
              >
                This release cannot be approved because its cover is unavailable. Retry the
                materials or reject the submission.
              </p>
              <Button variant="outline" size="sm" onClick={retryMaterials}>
                <IconRefresh className="size-3.5" />
                Retry materials
              </Button>
            </div>
          ) : null}
          <div className="grid gap-5 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
            <ListingField label="Cover">
              {listing.coverUrl ? (
                <ReviewImage
                  key={coverKey}
                  url={listing.coverUrl}
                  alt={`${listing.title} cover`}
                  onReadyChange={onCoverReadyChange}
                />
              ) : (
                <EmptyMaterial>Cover is unavailable.</EmptyMaterial>
              )}
            </ListingField>
            <ListingField label="Introduction">
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
                {listing.description}
              </p>
            </ListingField>
          </div>
          <ListingField label="Tags">
            {listing.tags.length ? (
              <div className="flex flex-wrap gap-2">
                {listing.tags.map((tag, index) => (
                  <span
                    key={`${tag}:${index}`}
                    className="rounded-md bg-slate-100 px-2 py-1 text-[12px] text-slate-700"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : (
              <EmptyMaterial>No tags provided.</EmptyMaterial>
            )}
          </ListingField>
          <ListingField label="Trailer">
            {listing.trailerUrl ? (
              <ReviewTrailer key={listing.trailerUrl} url={listing.trailerUrl} />
            ) : (
              <EmptyMaterial>No trailer is available.</EmptyMaterial>
            )}
          </ListingField>
          <ListingField label={`Screenshots (${listing.screenshots.length})`}>
            {listing.screenshots.length ? (
              <div className="grid grid-cols-2 items-start gap-3 md:grid-cols-3">
                {listing.screenshots.map((item, index) => (
                  <ReviewImage
                    key={`${item.url}:${index}`}
                    url={item.url}
                    alt={`${listing.title} screenshot ${index + 1}`}
                  />
                ))}
              </div>
            ) : (
              <EmptyMaterial>No screenshots are available.</EmptyMaterial>
            )}
          </ListingField>
        </div>
      )}
    </section>
  );
}

function ListingField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-2">
      <h3 className="text-[12px] font-medium text-slate-600">{label}</h3>
      {children}
    </div>
  );
}

function EmptyMaterial({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] text-slate-500">{children}</p>;
}

function ReviewImage({
  url,
  alt,
  onReadyChange,
}: {
  url: string;
  alt: string;
  onReadyChange?: (ready: boolean) => void;
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const onLoad = useCallback(() => onReadyChange?.(true), [onReadyChange]);
  const onError = useCallback(() => {
    onReadyChange?.(false);
    setFailed(true);
  }, [onReadyChange]);
  const imageRef = useCallback(
    (image: HTMLImageElement | null) => {
      // SSR media may finish before hydration attaches the load/error handlers.
      if (!image?.complete) return;
      if (image.naturalWidth > 0) onLoad();
      else onError();
    },
    [onLoad, onError]
  );
  if (failed)
    return (
      <MediaError
        url={url}
        onRetry={() => {
          onReadyChange?.(false);
          setFailed(false);
          setAttempt((value) => value + 1);
        }}
      />
    );
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block w-fit max-w-full rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
    >
      <img
        key={attempt}
        ref={imageRef}
        src={url}
        alt={alt}
        referrerPolicy="no-referrer"
        loading="lazy"
        onLoad={onLoad}
        onError={onError}
        className="h-auto max-h-60 w-auto max-w-full rounded-lg bg-slate-100"
      />
    </a>
  );
}

function ReviewTrailer({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  if (failed)
    return (
      <MediaError
        url={url}
        onRetry={() => {
          setFailed(false);
          setAttempt((value) => value + 1);
        }}
      />
    );
  return (
    <video
      key={attempt}
      src={url}
      controls
      playsInline
      preload="metadata"
      onError={() => setFailed(true)}
      className="max-h-80 w-full rounded-lg bg-slate-950"
    />
  );
}

function MediaError({ url, onRetry }: { url: string; onRetry: () => void }) {
  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-3">
      <p role="alert" className="text-[12px] text-red-700">
        Media could not be loaded.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onRetry}>
          <IconRefresh className="size-3.5" />
          Retry media
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href={url} target="_blank" rel="noopener noreferrer">
            Open media
          </a>
        </Button>
      </div>
    </div>
  );
}
