"use client";

import { useEffect, useRef, useState } from "react";
import { crewApi } from "@/app/(site)/crews/_hooks/api";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { getStudioHref } from "@/src/lib/region/cell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Film = { id: string; title: string };
type Page = { items: Film[]; nextCursor: string | null };
function unwrap<T>(result: { code: number; msg?: string; data: T }): T {
  if (result.code !== 200) throw new Error(result.msg || `Studio error ${result.code}`);
  return result.data;
}

export function WorkbenchFilmPicker({
  crewId,
  disabled,
  onSelect,
}: {
  crewId: string;
  disabled: boolean;
  onSelect: (url: string) => void;
}) {
  const t = useTranslations("crewTaskProject.workbench");
  const locale = useLocale();
  const [workspaceId, setWorkspaceId] = useState<string>();
  const [films, setFilms] = useState<Film[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [created, setCreated] = useState<Film>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const href = (id: string) =>
    `${getStudioHref(locale).replace(/\/$/, "")}/story-studio/projects/${encodeURIComponent(id)}/canvas`;
  async function list(more = false) {
    if (disabled || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    setOpened(true);
    try {
      const overview = await crewApi.get<{ studioWorkspace: { id: string } | null }>(
        `/crews/${encodeURIComponent(crewId)}/production-overview`
      );
      if (!alive.current) return;
      const id = overview.studioWorkspace?.id;
      setWorkspaceId(id);
      if (!id) {
        setFilms([]);
        setError(t("linkWorkspaceFirst"));
        return;
      }
      const query = new URLSearchParams({ workspaceId: id, limit: "100" });
      if (more && cursor && id === workspaceId) query.set("cursor", cursor);
      const page = unwrap(
        await crewApi.get<{ code: number; msg?: string; data: Page }>(`/story-projects?${query}`)
      );
      if (!alive.current) return;
      setFilms((current) =>
        more && id === workspaceId
          ? [...current, ...page.items.filter((item) => !current.some((old) => old.id === item.id))]
          : page.items
      );
      setCursor(page.nextCursor);
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : t("failed"));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function create() {
    if (disabled || lock.current || !workspaceId || !title.trim()) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const film = unwrap(
        await crewApi.post<{ code: number; msg?: string; data: { project: Film } }>(
          "/story-projects",
          { body: { workspaceId, title: title.trim(), defaultLocale: locale } }
        )
      ).project;
      if (!alive.current) return;
      setCreated(film);
      setFilms((current) => [film, ...current]);
      setTitle("");
      onSelect(href(film.id));
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : t("failed"));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <Button size="sm" variant="outline" disabled={disabled || busy} onClick={() => void list()}>
        {t("chooseFilm")}
      </Button>
      {opened && (
        <div className="space-y-2">
          <div className="max-h-48 overflow-auto">
            {films.map((film) => (
              <button
                key={film.id}
                type="button"
                disabled={disabled || busy}
                onClick={() => onSelect(href(film.id))}
                className="block w-full rounded-md px-2 py-2 text-left text-xs hover:bg-white/5"
              >
                {film.title}
              </button>
            ))}
          </div>
          {cursor && (
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled || busy}
              onClick={() => void list(true)}
            >
              {t("loadMoreFilms")}
            </Button>
          )}
          {workspaceId && (
            <div className="flex flex-wrap gap-2">
              <Input
                value={title}
                maxLength={180}
                aria-label={t("filmTitle")}
                placeholder={t("filmTitle")}
                disabled={disabled || busy}
                onChange={(event) => setTitle(event.target.value)}
              />
              <Button
                size="sm"
                disabled={disabled || busy || !title.trim()}
                onClick={() => void create()}
              >
                {t("createFilm")}
              </Button>
            </div>
          )}
          {created && (
            <a
              className="inline-block text-xs"
              href={href(created.id)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("openCreatedFilm", { title: created.title })}
            </a>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
