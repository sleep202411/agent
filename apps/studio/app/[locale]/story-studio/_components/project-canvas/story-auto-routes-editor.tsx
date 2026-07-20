"use client";

import { useId, useMemo, useState } from "react";
import { IconCheck, IconChevronDown, IconPlus, IconSearch, IconTrash } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type {
  FilmCondition,
  InteractiveFilmDraftContent,
  StoryAutoRoute,
  StoryGraphNode,
} from "@/lib/story-projects-api";
import { StoryConditionEditor } from "./story-condition-editor";

export interface AutoRoutePatch {
  targetNodeId?: string;
  priority?: number;
  when?: FilmCondition | null;
}

interface StoryAutoRoutesEditorProps {
  content: InteractiveFilmDraftContent;
  node: Extract<StoryGraphNode, { kind: "router" }>;
  canEdit: boolean;
  onAdd: (targetNodeId: string) => void;
  onUpdate: (routeIndex: number, patch: AutoRoutePatch) => void;
  onRemove: (routeIndex: number) => void;
}

export function StoryAutoRoutesEditor({
  content,
  node,
  canEdit,
  onAdd,
  onUpdate,
  onRemove,
}: StoryAutoRoutesEditorProps) {
  const t = useTranslations("storyStudio.canvas");
  const [newTargetNodeId, setNewTargetNodeId] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<number | null>(null);
  const targetNodes = content.graph.nodes.filter((candidate) => candidate.nodeId !== node.nodeId);
  const addRoute = () => {
    if (!newTargetNodeId) return;
    onAdd(newTargetNodeId);
    setNewTargetNodeId(null);
  };

  return (
    <section className="mt-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold text-white/78">{t("routes.title")}</h3>
          <p className="mt-1 text-[10px] leading-4 text-white/34">
            {t("routes.routerDescription")}
          </p>
        </div>
        <span className="rounded-full bg-white/[0.06] px-2 py-1 text-[9px] font-semibold tabular-nums text-white/42">
          {node.exit.routes.length}/20
        </span>
      </div>

      {node.exit.routes.length === 0 ? (
        <div className="mt-3 rounded-[16px] bg-[rgba(224,164,92,0.08)] px-3 py-3">
          <p className="text-[10px] font-semibold text-[#e0a45c]/82">{t("routes.empty")}</p>
          <p className="mt-1 text-[9px] leading-4 text-white/34">{t("routes.emptyDescription")}</p>
        </div>
      ) : null}

      <div className="mt-3 space-y-3">
        {node.exit.routes.map((route, routeIndex) => (
          <RouteEditor
            key={`${routeIndex}:${route.nextNodeId}`}
            route={route}
            routeIndex={routeIndex}
            content={content}
            targetNodes={targetNodes}
            canEdit={canEdit}
            onUpdate={(patch) => onUpdate(routeIndex, patch)}
            onRequestRemove={() => setPendingRemoval(routeIndex)}
          />
        ))}
      </div>

      {canEdit && node.exit.routes.length < 20 ? (
        <div className="mt-3 rounded-[16px] bg-white/[0.04] p-3">
          <p className="text-[10px] font-semibold text-white/42">{t("routes.add")}</p>
          <div className="mt-2 flex items-center gap-2">
            <TargetNodePicker
              value={newTargetNodeId}
              nodes={targetNodes}
              ariaLabel={t("routes.newTarget")}
              disabled={!canEdit}
              onChange={setNewTargetNodeId}
              className="min-w-0 flex-1"
            />
            <Button
              type="button"
              size="icon"
              variant="secondary"
              disabled={!newTargetNodeId}
              onClick={addRoute}
              aria-label={t("routes.add")}
            >
              <IconPlus className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemoval(null);
        }}
      >
        <DialogContent className="rounded-[22px] bg-[oklch(0.22_0_0/0.96)] p-5 shadow-[0_28px_100px_rgba(0,0,0,0.58)] backdrop-blur-[40px]">
          <DialogHeader>
            <DialogTitle>{t("routes.removeTitle")}</DialogTitle>
            <DialogDescription>{t("routes.removeDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">{t("inspector.cancel")}</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingRemoval !== null) onRemove(pendingRemoval);
                setPendingRemoval(null);
              }}
            >
              <IconTrash className="size-4" />
              {t("routes.remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function RouteEditor({
  route,
  routeIndex,
  content,
  targetNodes,
  canEdit,
  onUpdate,
  onRequestRemove,
}: {
  route: StoryAutoRoute;
  routeIndex: number;
  content: InteractiveFilmDraftContent;
  targetNodes: StoryGraphNode[];
  canEdit: boolean;
  onUpdate: (patch: AutoRoutePatch) => void;
  onRequestRemove: () => void;
}) {
  const t = useTranslations("storyStudio.canvas");
  return (
    <div className="rounded-[16px] bg-white/[0.045] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold text-white/42">
          {t("routes.routeLabel", { number: routeIndex + 1 })}
        </p>
        {canEdit ? (
          <button
            type="button"
            onClick={onRequestRemove}
            className="grid size-7 place-items-center rounded-lg bg-white/[0.05] text-white/34 transition hover:bg-white/[0.1] hover:text-[#ff9b9e]"
            aria-label={t("routes.remove")}
          >
            <IconTrash className="size-3.5" />
          </button>
        ) : null}
      </div>

      <label className="mt-2 block">
        <span className="text-[9px] font-semibold text-white/30">{t("inspector.target")}</span>
        <TargetNodePicker
          value={route.nextNodeId}
          nodes={targetNodes}
          ariaLabel={t("inspector.target")}
          disabled={!canEdit}
          onChange={(targetNodeId) => onUpdate({ targetNodeId })}
          className="mt-1.5"
        />
      </label>

      <label className="mt-3 block">
        <span className="text-[9px] font-semibold text-white/30">{t("routes.priority")}</span>
        <Input
          type="number"
          min={0}
          max={10_000}
          step={1}
          value={route.priority}
          disabled={!canEdit}
          onChange={(event) =>
            onUpdate({
              priority: Math.min(10_000, Math.max(0, Math.round(event.target.valueAsNumber || 0))),
            })
          }
          className="mt-1.5 h-9 rounded-xl bg-black/18 px-3"
        />
      </label>

      {route.when ? (
        <div className="mt-3">
          <StoryConditionEditor
            value={route.when}
            content={content}
            canEdit={canEdit}
            onChange={(when) => onUpdate({ when })}
            onRemove={() => onUpdate({ when: null })}
          />
        </div>
      ) : canEdit ? (
        <Button
          type="button"
          variant="ghost"
          className="mt-2 w-full"
          onClick={() => onUpdate({ when: defaultCondition() })}
        >
          <IconPlus className="size-4" />
          {t("routes.addCondition")}
        </Button>
      ) : (
        <p className="mt-3 text-[9px] text-white/30">{t("routes.unconditional")}</p>
      )}
    </div>
  );
}

export function TargetNodePicker({
  value,
  nodes,
  ariaLabel,
  disabled,
  onChange,
  className,
}: {
  value: string | null;
  nodes: StoryGraphNode[];
  ariaLabel: string;
  disabled?: boolean;
  onChange: (nodeId: string) => void;
  className?: string;
}) {
  const t = useTranslations("storyStudio.canvas");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listboxId = useId();
  const selected = nodes.find((node) => node.nodeId === value) ?? null;
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return nodes;
    return nodes.filter((node) =>
      `${graphNodeLabel(node)} ${node.nodeId} ${node.kind}`.toLowerCase().includes(normalized)
    );
  }, [nodes, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listboxId}
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-xl bg-black/18 px-3 text-left text-[10px] text-white/68 transition hover:bg-black/26 disabled:opacity-50",
            className
          )}
        >
          <span className={cn("min-w-0 truncate", !selected && "text-white/30")}>
            {selected ? graphNodeLabel(selected) : t("inspector.targetPlaceholder")}
          </span>
          <IconChevronDown className="size-3.5 shrink-0 text-white/30" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[304px] gap-2 rounded-[16px] bg-[oklch(0.24_0_0/0.98)] p-2 shadow-[0_20px_70px_rgba(0,0,0,0.5)]"
      >
        <label className="relative block">
          <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-white/28" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("routes.searchTarget")}
            className="h-9 rounded-xl bg-black/20 pr-3 pl-8"
          />
        </label>
        <div id={listboxId} role="listbox" className="max-h-60 space-y-1 overflow-y-auto">
          {filtered.map((node) => (
            <button
              type="button"
              role="option"
              aria-selected={node.nodeId === value}
              key={node.nodeId}
              onClick={() => {
                onChange(node.nodeId);
                setOpen(false);
                setQuery("");
              }}
              className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition hover:bg-white/[0.07]"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[10px] font-semibold text-white/70">
                  {graphNodeLabel(node)}
                </span>
                <span className="mt-0.5 block truncate font-mono text-[8px] text-white/28">
                  {t(`nodeKinds.${node.kind}`)} · {node.nodeId}
                </span>
              </span>
              {node.nodeId === value ? <IconCheck className="size-3.5 text-white/64" /> : null}
            </button>
          ))}
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-[10px] text-white/30">
              {t("routes.noTargets")}
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function graphNodeLabel(node: StoryGraphNode): string {
  return node.kind === "clip" ? node.clipKey : node.nodeId;
}

function defaultCondition(): FilmCondition {
  return { kind: "flag", flag: "story_flag", equals: true };
}
