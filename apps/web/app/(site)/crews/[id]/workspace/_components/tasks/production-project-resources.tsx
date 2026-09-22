"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  IconExternalLink,
  IconFile,
  IconLink,
  IconLoader2,
  IconPlus,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";

import {
  useCreateCrewProductionResource,
  useDeleteCrewProductionResource,
  type CrewProductionOverviewDTO,
} from "@/app/(site)/crews/_hooks/use-crew";
import {
  useCrewAssets,
  type CrewAssetNodeDTO,
} from "@/app/(site)/crews/[id]/workspace/_hooks/use-crew-assets";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";

export function ProductionProjectResources({
  crewId,
  overview,
}: {
  crewId: string;
  overview: CrewProductionOverviewDTO;
}) {
  const t = useTranslations("crewProduction");

  return (
    <div className="flex items-start gap-4">
      <span className="w-[74px] shrink-0 pt-1 text-[#747983]">{t("resources.title")}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {overview.resources.map((resource) => {
          const optimistic = resource.id.startsWith("optimistic-");
          return (
            <div
              key={resource.id}
              aria-busy={optimistic}
              className={cn(
                "group/resource flex h-7 max-w-[280px] items-center gap-1.5 rounded-md px-2 text-[#a5aab3] transition-colors hover:bg-white/[0.045] hover:text-[#d9dce1]",
                optimistic && "opacity-60"
              )}
            >
              {resource.kind === "link" ? (
                <IconLink className="size-3.5 shrink-0" />
              ) : (
                <IconFile className="size-3.5 shrink-0" />
              )}
              {resource.kind === "link" && resource.url ? (
                <a href={resource.url} target="_blank" rel="noreferrer" className="truncate">
                  {resource.title}
                </a>
              ) : (
                <Link
                  href={`?tab=assets&asset=${encodeURIComponent(resource.assetNodeId ?? "")}`}
                  className="truncate"
                >
                  {resource.title}
                </Link>
              )}
              {resource.kind === "link" ? (
                <IconExternalLink className="size-3 shrink-0 opacity-60" />
              ) : null}
              {overview.capabilities.manage && !optimistic ? (
                <DeleteResourceButton crewId={crewId} resourceId={resource.id} />
              ) : null}
            </div>
          );
        })}
        {overview.capabilities.manage ? <ResourcePicker crewId={crewId} /> : null}
      </div>
    </div>
  );
}

function ResourcePicker({ crewId }: { crewId: string }) {
  const t = useTranslations("crewProduction");
  const tc = useTranslations("common");
  const createResource = useCreateCrewProductionResource(crewId);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"link" | "asset">("link");
  const draftRevision = useRef(0);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [query, setQuery] = useState("");
  const assets = useCrewAssets(
    crewId,
    { source: "all", query: query.trim() || undefined, kind: "file", sort: "modified" },
    open && mode === "asset"
  );
  const items = assets.data?.items ?? [];
  const validUrl = isHttpUrl(url.trim());

  const close = () => {
    draftRevision.current += 1;
    setOpen(false);
    setTitle("");
    setUrl("");
    setQuery("");
  };

  const addLink = async () => {
    const input = {
      kind: "link" as const,
      ...(title.trim() ? { title: title.trim() } : {}),
      url: url.trim(),
    };
    const revision = draftRevision.current;
    setOpen(false);
    try {
      await createResource.mutateAsync(input);
      if (draftRevision.current === revision) close();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("resources.addFailed"));
    }
  };

  const addAsset = async (asset: CrewAssetNodeDTO) => {
    close();
    try {
      await createResource.mutateAsync({
        kind: "asset",
        assetNodeId: asset.id,
        title: asset.name,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("resources.addFailed"));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
        else {
          draftRevision.current += 1;
          setOpen(true);
        }
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[#777d86] hover:bg-white/[0.04] hover:text-[#c9cdd3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
        >
          <IconPlus className="size-3.5" />
          {t("resources.add")}
        </button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/65 backdrop-blur-[1px]"
        className="w-[540px] max-w-[calc(100%-2rem)] overflow-hidden rounded-xl border border-white/[0.11] bg-[#191a1e] p-0 text-[#d9dce1] shadow-[0_28px_90px_rgba(0,0,0,.72)] sm:max-w-[540px]"
      >
        <div className="flex items-center gap-2 border-b border-white/[0.07] px-5 py-4">
          <IconLink className="size-4 text-[#8d939c]" />
          <DialogTitle className="text-[13px] font-semibold">
            {t("resources.dialogTitle")}
          </DialogTitle>
        </div>
        <div className="flex h-10 items-center gap-1 border-b border-white/[0.07] px-5">
          {(["link", "asset"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setMode(item)}
              className={cn(
                "h-7 rounded-md px-2.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
                mode === item
                  ? "bg-white/[0.075] text-[#e1e3e6]"
                  : "text-[#777d86] hover:text-[#bfc3ca]"
              )}
            >
              {t(`resources.kind.${item}`)}
            </button>
          ))}
        </div>
        {mode === "link" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (validUrl) void addLink();
            }}
          >
            <DialogBody className="space-y-4 px-5 py-4">
              <label className="block space-y-1.5">
                <span className="text-[11px] font-medium text-[#b9bdc5]">{t("resources.url")}</span>
                <Input
                  autoFocus
                  value={url}
                  onChange={(event) => {
                    draftRevision.current += 1;
                    setUrl(event.target.value);
                  }}
                  placeholder="https://"
                  inputMode="url"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[11px] font-medium text-[#b9bdc5]">
                  {t("resources.linkTitle")}
                </span>
                <Input
                  value={title}
                  onChange={(event) => {
                    draftRevision.current += 1;
                    setTitle(event.target.value);
                  }}
                  placeholder={t("resources.linkTitleOptional")}
                />
              </label>
            </DialogBody>
            <DialogFooter className="border-white/[0.07] px-5 py-3">
              <DialogClose asChild>
                <Button type="button" variant="outline" size="sm">
                  {t("resources.cancel")}
                </Button>
              </DialogClose>
              <Button type="submit" size="sm" disabled={!validUrl}>
                {t("resources.addLink")}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <DialogBody className="space-y-0 p-0">
            <div className="flex h-10 items-center gap-2 border-b border-white/[0.06] px-3">
              <IconSearch className="size-3.5 text-[#666d77]" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("resources.searchAssets")}
                className="min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-[#626873]"
              />
            </div>
            <div className="max-h-64 overflow-y-auto p-1.5">
              {assets.isLoading ? (
                <div className="flex h-24 items-center justify-center">
                  <IconLoader2 className="size-4 animate-spin text-[#747b85]" />
                </div>
              ) : null}
              {assets.isError ? (
                <div role="alert" className="space-y-2 px-3 py-3 text-xs text-destructive">
                  <p>{assets.error.message}</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={assets.isFetching}
                    onClick={() =>
                      void (assets.isFetchNextPageError
                        ? assets.fetchNextPage({ cancelRefetch: false })
                        : assets.refetch())
                    }
                  >
                    {tc("retry")}
                  </Button>
                </div>
              ) : null}
              {items.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => void addAsset(asset)}
                  className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] text-[#b9bdc5] hover:bg-white/[0.055] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                >
                  <IconFile className="size-3.5 shrink-0 text-[#7c838d]" />
                  <span className="truncate">{asset.name}</span>
                </button>
              ))}
              {assets.hasNextPage ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={assets.isFetching}
                  onClick={() => void assets.fetchNextPage({ cancelRefetch: false })}
                >
                  {tc("loadMore")}
                </Button>
              ) : null}
              {!assets.isLoading && !assets.isError && items.length === 0 ? (
                <p className="px-3 py-8 text-center text-[10px] text-[#696f79]">
                  {t("resources.noAssets")}
                </p>
              ) : null}
            </div>
          </DialogBody>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeleteResourceButton({ crewId, resourceId }: { crewId: string; resourceId: string }) {
  const t = useTranslations("crewProduction");
  const remove = useDeleteCrewProductionResource(crewId);

  return (
    <button
      type="button"
      disabled={remove.isPending}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void remove
          .mutateAsync(resourceId)
          .catch((error: unknown) =>
            toast.error(error instanceof Error ? error.message : t("resources.removeFailed"))
          );
      }}
      className="ml-0.5 grid size-4 shrink-0 place-items-center rounded opacity-0 hover:bg-white/[0.08] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 group-hover/resource:opacity-100"
      aria-label={t("resources.remove")}
    >
      {remove.isPending ? (
        <IconLoader2 className="size-3 animate-spin" />
      ) : (
        <IconX className="size-3" />
      )}
    </button>
  );
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
