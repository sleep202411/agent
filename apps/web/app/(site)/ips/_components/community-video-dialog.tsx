"use client";

import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { listIpCommerceIps } from "@/src/lib/ip-commerce/api";
import { uploadFileViaSignedUrl } from "@/src/lib/media-upload";
import { api } from "@/src/lib/api";

export function CommunityVideoDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("communityVideo");
  const { user } = useCurrentUser();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {open ? <VideoForm key={user?.id ?? "guest"} /> : null}
      </DialogContent>
    </Dialog>
  );
}
function VideoForm() {
  const t = useTranslations("communityVideo");
  const locale = useLocale();
  const { user } = useCurrentUser();
  const auth = useAuthDialog();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState<{ id: string; title: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const asset = useRef<string | null>(null);
  const operation = useRef<AbortController | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      operation.current?.abort();
    };
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const channels = useInfiniteQuery({
    queryKey: ["community-video-channels", query, locale, user?.id],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      listIpCommerceIps(
        { channelType: "community", q: query || undefined, locale, limit: 20, cursor: pageParam },
        signal
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!user) {
      auth.open();
      return;
    }
    if (operation.current || !file || !channel || !title.trim()) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      const settings = await api.get<{ open: boolean }>(
        `/aurora/ip-commerce/ips/${encodeURIComponent(channel.id)}/submissions`,
        { signal: controller.signal, cache: "no-store" }
      );
      if (!settings.open) throw new Error(t("closed"));
      if (!asset.current) {
        const uploaded = await uploadFileViaSignedUrl(file, {
          kind: "episode_video",
          signal: controller.signal,
          onProgress: (value) => {
            if (active.current) setProgress(value);
          },
        });
        asset.current = uploaded.mediaAssetId;
      }
      controller.signal.throwIfAborted();
      await api.post(
        `/aurora/ip-commerce/ips/${encodeURIComponent(channel.id)}/video-submissions`,
        {
          data: { assetId: asset.current, title: title.trim(), description: description.trim() },
          signal: controller.signal,
        }
      );
      if (active.current) {
        setDone(true);
        void client.invalidateQueries({ queryKey: ["channel-videos", channel.id] });
      }
    } catch (err) {
      if (active.current) setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      operation.current = null;
      if (active.current) setBusy(false);
    }
  }
  if (!user)
    return (
      <div className="p-5">
        <Button onClick={() => auth.open()}>{t("signIn")}</Button>
      </div>
    );
  if (done)
    return (
      <p role="status" className="px-5 py-6 text-sm">
        {t("success")}
      </p>
    );
  return (
    <form onSubmit={submit} className="space-y-4 px-5 py-4">
      <fieldset disabled={busy} className="space-y-4">
        <label className="block space-y-2 text-sm">
          <span className="block">{t("video")}</span>
          <Input
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            required
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              asset.current = null;
            }}
          />
        </label>
        <label className="block space-y-2 text-sm">
          <span className="block">{t("name")}</span>
          <Input
            value={title}
            maxLength={200}
            required
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="block space-y-2 text-sm">
          <span className="block">{t("intro")}</span>
          <Textarea
            value={description}
            maxLength={5000}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="block space-y-2 text-sm">
          <span className="block">{t("channel")}</span>
          <Input
            value={search}
            placeholder={t("search")}
            onChange={(e) => {
              setSearch(e.target.value);
              setChannel(null);
            }}
          />
        </label>
        {channel ? <p className="text-sm">{t("selected", { name: channel.title })}</p> : null}
        <div className="max-h-40 space-y-1 overflow-y-auto" role="group" aria-label={t("channel")}>
          {channels.data?.pages
            .flatMap((page) => page.items)
            .map((item) => (
              <button
                type="button"
                key={item.id}
                aria-pressed={channel?.id === item.id}
                className={`block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-white/10 ${channel?.id === item.id ? "bg-white/10" : ""}`}
                onClick={() => setChannel({ id: item.id, title: item.title })}
              >
                {item.title}
              </button>
            ))}
          {channels.isPending ? (
            <p role="status">{t("loading")}</p>
          ) : channels.isError ? (
            <div role="alert">
              <p>{channels.error.message}</p>
              <Button type="button" variant="outline" onClick={() => void channels.refetch()}>
                {t("retry")}
              </Button>
            </div>
          ) : !channels.data?.pages.some((page) => page.items.length) ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : null}
          {channels.hasNextPage ? (
            <Button
              type="button"
              variant="ghost"
              disabled={channels.isFetchingNextPage}
              onClick={() => void channels.fetchNextPage()}
            >
              {t("more")}
            </Button>
          ) : null}
        </div>
      </fieldset>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {busy ? (
        <p role="status" className="text-sm">
          {t("uploading", { progress: Math.round(progress) })}
        </p>
      ) : null}
      <Button
        type="submit"
        disabled={busy || !channel || !file || !title.trim()}
        className="w-full"
      >
        {t("submit")}
      </Button>
    </form>
  );
}
