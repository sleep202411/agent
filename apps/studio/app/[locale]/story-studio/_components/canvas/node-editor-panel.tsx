"use client";

import type { ReactNode } from "react";
import { IconArrowUpRight, IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { KIND_META } from "./cards/kind-meta";
import { NODE_LIBRARY } from "./node-defaults";
import type { NarrativeNode, NarrativeNodeData } from "./types";

function parseEditorList(value: string) {
  return value
    .split(/[，,、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatEditorList(value?: string[]) {
  return (value ?? []).join("、");
}

function EditorField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="block">
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/34">
        {label}
      </span>
      <div className="mt-2">{children}</div>
      {hint ? (
        <span className="mt-2 block text-xs font-semibold leading-5 text-white/34">{hint}</span>
      ) : null}
    </div>
  );
}

function EditorInput({
  value,
  onChange,
  placeholder,
}: {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="h-11 w-full rounded-[18px] bg-black/18 px-4 text-sm font-semibold text-white/82 outline-none transition placeholder:text-white/24 focus:bg-black/26"
    />
  );
}

function EditorTextarea({
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full resize-none rounded-[20px] bg-black/18 px-4 py-3 text-sm font-semibold leading-6 text-white/82 outline-none transition placeholder:text-white/24 focus:bg-black/26"
    />
  );
}

export function NodeEditorPanel({
  node,
  onClose,
  onChange,
  onDelete,
}: {
  node: NarrativeNode;
  onClose: () => void;
  onChange: (patch: Partial<NarrativeNodeData>) => void;
  onDelete: () => void;
}) {
  const data = node.data;
  const meta = KIND_META[data.kind];
  const MetaIcon = meta.icon;

  const commonFields = (
    <div className="space-y-4">
      <EditorField label="标题">
        <EditorInput value={data.label} onChange={(label) => onChange({ label })} />
      </EditorField>
      <EditorField label="节点说明">
        <EditorTextarea
          value={data.summary}
          onChange={(summary) => onChange({ summary })}
          placeholder="这个节点在故事结构里负责什么？"
        />
      </EditorField>
      <EditorField label="标签">
        <EditorInput
          value={formatEditorList(data.chips)}
          onChange={(value) => onChange({ chips: parseEditorList(value) })}
          placeholder="用顿号、逗号或换行分隔"
        />
      </EditorField>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/34">状态</p>
        <div className="mt-2 grid grid-cols-3 gap-2 rounded-[20px] bg-black/16 p-1">
          {(
            [
              ["ready", "已就绪"],
              ["working", "生成中"],
              ["review", "待审阅"],
            ] as const
          ).map(([status, label]) => (
            <button
              key={status}
              type="button"
              onClick={() => onChange({ status })}
              className={cn(
                "h-10 rounded-[16px] text-xs font-black transition",
                data.status === status
                  ? "bg-white text-black"
                  : "text-white/46 hover:bg-white/8 hover:text-white"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const typeFields = (() => {
    if (data.kind === "ending") {
      return (
        <div className="space-y-4">
          <EditorField label="结局类型">
            <div className="grid grid-cols-2 gap-2 rounded-[20px] bg-black/16 p-1">
              {(
                [
                  ["truth", "主线"],
                  ["intervention", "中断"],
                  ["failure", "失败"],
                  ["hidden", "隐藏"],
                ] as const
              ).map(([endingType, label]) => (
                <button
                  key={endingType}
                  type="button"
                  onClick={() => onChange({ endingType })}
                  className={cn(
                    "rounded-[16px] px-3 py-2 text-sm font-semibold transition",
                    data.endingType === endingType
                      ? "bg-white text-black"
                      : "text-white/46 hover:bg-white/8 hover:text-white"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </EditorField>
          <EditorField label="达成方式">
            <EditorTextarea
              value={data.endingTrigger}
              onChange={(endingTrigger) => onChange({ endingTrigger })}
              rows={4}
            />
          </EditorField>
          <EditorField label="结局复盘">
            <EditorTextarea
              value={data.endingReview}
              onChange={(endingReview) => onChange({ endingReview })}
              rows={4}
            />
          </EditorField>
        </div>
      );
    }

    if (data.kind === "clue") {
      return (
        <div className="space-y-4">
          <EditorField label="线索类型">
            <EditorInput value={data.clueType} onChange={(clueType) => onChange({ clueType })} />
          </EditorField>
          <EditorField label="来源">
            <EditorTextarea
              value={data.clueSource}
              onChange={(clueSource) => onChange({ clueSource })}
              rows={3}
            />
          </EditorField>
          <EditorField label="用途">
            <EditorTextarea
              value={data.clueUse}
              onChange={(clueUse) => onChange({ clueUse })}
              rows={3}
            />
          </EditorField>
          <EditorField label="AI 约束">
            <EditorTextarea
              value={data.clueRule}
              onChange={(clueRule) => onChange({ clueRule })}
              rows={4}
            />
          </EditorField>
        </div>
      );
    }

    if (data.kind === "role") {
      return (
        <div className="space-y-4">
          <EditorField label="角色定位">
            <div className="grid grid-cols-2 gap-2 rounded-[20px] bg-black/16 p-1">
              {(
                [
                  ["protagonist", "主角"],
                  ["relation", "关系角色"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onChange({ characterMode: mode })}
                  className={cn(
                    "h-10 rounded-[16px] text-xs font-black transition",
                    data.characterMode === mode
                      ? "bg-white text-black"
                      : "text-white/46 hover:bg-white/8 hover:text-white"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </EditorField>
          <EditorField label="角色图片">
            <div className="grid grid-cols-2 gap-2 rounded-[20px] bg-black/16 p-1">
              {(
                [
                  ["female", "女性"],
                  ["male", "男性"],
                  ["neutral", "中性"],
                ] as const
              ).map(([portrait, label]) => (
                <button
                  key={portrait}
                  type="button"
                  onClick={() => onChange({ characterPortrait: portrait, image: "avatar" })}
                  className={cn(
                    "h-10 rounded-[16px] text-xs font-black transition",
                    data.characterPortrait === portrait
                      ? "bg-white text-black"
                      : "text-white/46 hover:bg-white/8 hover:text-white"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </EditorField>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <EditorField label="补充信息">
          <EditorTextarea
            value={data.meta}
            onChange={(metaValue) => onChange({ meta: metaValue })}
            placeholder="素材规格、生成状态、运行说明或创作备注。"
            rows={4}
          />
        </EditorField>
      </div>
    );
  })();

  return (
    <aside
      data-testid="node-editor-panel"
      className="absolute bottom-6 right-6 top-[104px] z-50 flex w-[430px] flex-col overflow-hidden rounded-[32px] bg-[oklch(0.18_0_0)/0.94] text-white shadow-[0_28px_100px_rgba(0,0,0,0.52)] backdrop-blur-2xl duration-300 animate-in fade-in-0 slide-in-from-right-5"
      aria-label="节点编辑器"
    >
      <div className="bg-white/[0.04] px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={cn("grid size-11 shrink-0 place-items-center rounded-full", meta.glow)}
            >
              <MetaIcon className={cn("size-5", meta.accent)} stroke={1.8} />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/36">
                {NODE_LIBRARY.find((item) => item.kind === data.kind)?.title ?? data.kind}
              </p>
              <h2 className="mt-1 line-clamp-2 text-xl font-black leading-tight text-white/94">
                {data.label}
              </h2>
              <p className="mt-2 text-xs font-semibold text-white/40">
                双击节点也可以快速打开这里。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-white/8 text-white/58 transition hover:bg-white/12 hover:text-white"
            aria-label="关闭节点编辑器"
          >
            <IconX className="size-5" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {commonFields}
        <div className="my-5 h-px bg-white/8" />
        {typeFields}
      </div>

      <div className="bg-black/14 p-5">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-[#E52227]/14 px-4 text-sm font-black text-[#ff9b9e] transition hover:bg-[#E52227]/20"
          >
            <IconX className="size-4" />
            移除节点
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-black text-black transition hover:bg-white/88 active:translate-y-0.5"
          >
            保存到画布
            <IconArrowUpRight className="size-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
