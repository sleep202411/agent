"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useCurrentUser } from "@/src/hooks/use-user";
import Link from "next/link";
import { IconArrowRight, IconDots, IconLoader2, IconPlus } from "@tabler/icons-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { env } from "@/src/env";
import { backendApi, type Paginated } from "@/src/lib/api";
import { useTranslations } from "@/src/i18n/i18n";
import { localizePath, getCurrentLocale } from "@/src/i18n/locale-url";
import { localizedProjectWorkspaceHref } from "@/src/lib/studio-routes";
import { worldKeys, type V1WorldProduct } from "@/src/hooks/use-worlds";
import { useMyProducts, myProductsKeys, type MyProduct } from "../_hooks/use-my-products";
import { CreateWorldDialog } from "./create-world-dialog";

const OSS_BASE = env.OSS_BASE_URL;

function ossUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `${OSS_BASE}/${path}`;
}

/**
 * Studio home — recent projects strip (top 8 from
 * `/api/user/world/list/myproduct`). Provides a fast preview into the
 * user's library without dragging in the full /projects page chrome
 * (own/created tabs, flat/grouped toggle, world grouping). The "View
 * all →" link in the header takes the user to the dedicated list.
 *
 * Includes a `+` create card as the first grid slot — the same
 * `CreateWorldDialog` ProjectsSection uses, kept here so the home page
 * doesn't lose the explicit "create with file upload + manual fields"
 * affordance just because we slimmed the preview down. The studio
 * composer above is the AI-led creation path; this card is the
 * file-led / form-led one.
 */
export function RecentProjectsPreview() {
  const tw = useTranslations("workspace");
  // Fetch 4 — the Create card takes one slot so the strip caps at 5
  // visible cards total. Bumping `viewAll` is the path to the rest.
  const { products, totalCount, isLoading } = useMyProducts({ pageSize: 4 });
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  return (
    <section className="flex w-full flex-col gap-4">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-lg font-semibold">{tw("recentProjects")}</h2>
          <p className="text-sm text-muted-foreground">
            {tw("projectCount", { count: totalCount })}
          </p>
        </div>
        <Link
          href={localizePath("/art-studio/projects", getCurrentLocale())}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {tw("viewAll")}
          <IconArrowRight className="size-3.5" />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        <CreateButton onClick={() => setCreateDialogOpen(true)} />
        {isLoading && Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
        {!isLoading && products.map((p) => <ProductCard key={p.id} product={p} />)}
        {!isLoading && products.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
            {tw("noProjectsYetHint")}
          </p>
        )}
      </div>

      <CreateWorldDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
    </section>
  );
}

export function ProductCard({ product }: { product: MyProduct }) {
  const { user } = useCurrentUser();
  return (
    <OwnedProductCard
      key={JSON.stringify([user?.id, product.id, product.worldId])}
      product={product}
    />
  );
}
function OwnedProductCard({ product }: { product: MyProduct }) {
  const tw = useTranslations("workspace");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const cover = ossUrl(product.imagePath);
  const description = product.description?.trim() || tw("noDescription");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [isLastInWorld, setIsLastInWorld] = useState(false);
  const active = useRef(true);
  const operation = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      operation.current?.abort();
      operation.current = null;
    };
  }, []);
  const begin = () => {
    if (!active.current || operation.current) return null;
    const run = new AbortController();
    operation.current = run;
    return run;
  };
  const owns = (run: AbortController) =>
    active.current && operation.current === run && !run.signal.aborted;

  // The home strip is a flat product list, so we don't know up front
  // whether this is the only project in its world. Java rejects a
  // worldproduct delete for the last one — the contract is "delete the
  // world itself, which cascades" — so fetch the world's product count
  // first to pick the right endpoint and warn the user accordingly.
  const openDeleteConfirm = async () => {
    const run = begin();
    if (!run) return;
    setPreparing(true);
    try {
      const res = await backendApi.post<Paginated<V1WorldProduct>>(
        "/api/user/world/list/worldproduct",
        { signal: run.signal, data: { page: 1, pageSize: 100, worldId: product.worldId } }
      );
      if (!owns(run)) return;
      if (!(res.list ?? []).some((item) => String(item.id) === String(product.id)))
        throw new Error(tw("projectLoadFailed"));
      setIsLastInWorld(res.list.length === 1 && res.totalCount === 1);
      setConfirmOpen(true);
    } catch (err) {
      if (!owns(run)) return;
      toast.error(err instanceof Error ? err.message : tw("projectLoadFailed"));
    } finally {
      if (owns(run)) {
        operation.current = null;
        setPreparing(false);
      }
    }
  };

  const handleDelete = async () => {
    const run = begin();
    if (!run) return;
    setDeleting(true);
    try {
      if (isLastInWorld) {
        await backendApi.post("/api/user/world/delete/world", {
          signal: run.signal,
          data: { id: product.worldId },
        });
      } else {
        // Non-last: delete only the project. Java expects `id` on the
        // query string (body form returns 未知異常).
        await backendApi.post(
          `/api/user/world/delete/worldproduct?id=${encodeURIComponent(product.id)}`,
          { signal: run.signal }
        );
      }
      if (!owns(run)) return;
      toast.success(tw("projectDeleteSuccess"));
      setConfirmOpen(false);
      // Refresh the home strip + this world's product list; if the world
      // itself went away, refresh the world list too.
      void queryClient.invalidateQueries({ queryKey: myProductsKeys.all });
      void queryClient.invalidateQueries({ queryKey: worldKeys.products(product.worldId) });
      if (isLastInWorld) {
        void queryClient.invalidateQueries({ queryKey: worldKeys.all });
      }
    } catch (err) {
      if (!owns(run)) return;
      console.error("[RecentProjectsPreview] delete failed", err);
      toast.error(err instanceof Error ? err.message : tw("projectDeleteFailed"));
    } finally {
      if (owns(run)) {
        operation.current = null;
        setDeleting(false);
      }
    }
  };

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-border/70 bg-card transition-colors hover:border-border">
      <Link
        href={localizedProjectWorkspaceHref(product.id, {
          worldId: product.worldId,
        })}
        className="flex flex-col"
      >
        <div className="relative aspect-video w-full bg-muted">
          <img src={cover ?? "/default-cover.jpg"} alt="" className="size-full object-cover" />
        </div>
        <div className="p-3">
          <p className="truncate text-sm font-medium">{product.name}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p>
        </div>
      </Link>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={tw("projectMenuDelete")}
            className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-md bg-background/80 opacity-0 backdrop-blur-sm transition-opacity hover:bg-muted group-hover:opacity-100 data-[state=open]:opacity-100"
          >
            {preparing ? (
              <IconLoader2 className="size-4 animate-spin" />
            ) : (
              <IconDots className="size-4" />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link
              href={localizedProjectWorkspaceHref(product.id, {
                worldId: product.worldId,
              })}
            >
              {tw("projectMenuOpen")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            disabled={preparing || deleting}
            onSelect={(e) => {
              e.preventDefault();
              void openDeleteConfirm();
            }}
          >
            {tw("projectMenuDelete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tw("projectDeleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {isLastInWorld
                ? tw("projectDeleteConfirmDescriptionLastInWorldShort", { name: product.name })
                : tw("projectDeleteConfirmDescription", { name: product.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting || preparing}>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting || preparing}
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <IconLoader2 className="mr-1.5 size-3.5 animate-spin" />}
              {tw("projectMenuDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CreateButton({ onClick }: { onClick: () => void }) {
  const tw = useTranslations("workspace");
  return (
    <button
      type="button"
      onClick={onClick}
      className="group overflow-hidden rounded-xl border border-dashed border-border/70 bg-card transition-all hover:border-primary/40 hover:bg-muted/40"
    >
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-muted/30 py-8">
        <div className="flex size-10 items-center justify-center rounded-full bg-foreground text-background">
          <IconPlus className="size-5" />
        </div>
        <span className="text-sm font-medium">{tw("createWorld")}</span>
      </div>
    </button>
  );
}

function SkeletonCard() {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border/70 bg-card">
      <div className="aspect-video w-full animate-pulse bg-muted" />
      <div className="space-y-2 p-3">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="h-3 w-32 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}
