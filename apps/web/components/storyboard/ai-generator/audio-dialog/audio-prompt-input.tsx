"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  IconArrowUp,
  IconChevronDown,
  IconLoader2,
  IconMicrophone,
  IconWand,
  IconX,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { RichMentionEditor } from "@/components/storyboard/editor/rich-mention-editor";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RawAiModel } from "@/src/types/workspace";
import type { MentionItem } from "@/components/storyboard/editor/mention-node";
import type { Asset } from "@/src/store/slices/projectSlice";

const OSS_BASE = process.env.NEXT_PUBLIC_OSS_BASE_URL ?? "";

function getRoleImagePath(role?: Asset) {
  const roleImgPath = Array.isArray(role?.roleImgPath)
    ? role.roleImgPath.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
  if (roleImgPath[0]) return roleImgPath[0];
  if (role?.otherImgPath && typeof role.otherImgPath === "object") {
    const first = Object.values(role.otherImgPath)
      .map((item) => String(item ?? "").trim())
      .find(Boolean);
    if (first) return first;
  }
  return "";
}

function ossUrl(path?: string) {
  if (!path) return "";
  if (path.startsWith("http") || path.startsWith("blob:")) return path;
  return `${OSS_BASE}/${path}`;
}

interface AudioPromptInputProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  model: string;
  onModelChange: (value: string) => void;
  voiceModels: RawAiModel[];
  selectedVoiceName: string;
  onOpenVoicePicker: () => void;
  onClearVoice?: () => void;
  hasVoice: boolean;
  count: number;
  onCountChange: (value: number) => void;
  cost?: number;
  loading?: boolean;
  isGenerating?: boolean;
  onSubmit: () => void;
  characters: Asset[];
}

export function AudioPromptInput({
  prompt,
  onPromptChange,
  model,
  onModelChange,
  voiceModels,
  selectedVoiceName,
  onOpenVoicePicker,
  onClearVoice,
  hasVoice,
  count,
  onCountChange,
  cost = 0,
  loading,
  isGenerating,
  onSubmit,
  characters,
}: AudioPromptInputProps) {
  const t = useTranslations("storyboard");
  const mentionItems = useMemo<MentionItem[]>(
    () =>
      characters
        .filter((role) => role.id && role.name)
        .map((role) => ({
          id: String(role.id),
          label: String(role.name),
          mentionType: "character" as const,
          imgUrl: ossUrl(getRoleImagePath(role)),
          voiceId: typeof role.voiceId === "string" ? role.voiceId.trim() : "",
          model: typeof role.model === "string" ? role.model.trim() : "",
        })),
    [characters]
  );

  return (
    <div className="rounded-lg border border-white/20 bg-[#31313A] p-2">
      <RichMentionEditor
        value={prompt}
        onChange={onPromptChange}
        placeholder="请输入需要配音的台词文本，支持 @角色"
        mentionItems={mentionItems}
        mentionTypes={["character"]}
        showAvatar={false}
        extraFields={["voiceId", "model"]}
        minHeight={160}
        className="px-2 pt-2 [&_[contenteditable]]:text-[15px] [&_[contenteditable]]:leading-7 [&_[contenteditable]]:text-white"
        onSubmitShortcut={onSubmit}
        submitMode="mod"
      />

      <div className="px-2 pb-2 text-[11px] text-[#8F8F92]">
        未指定时，自动匹配提示词中角色的配音设置
      </div>

      <div className="flex items-end justify-between gap-4 pt-2">
        <div className="flex items-center gap-3">
          {/* Model Select */}
          <Select value={model} onValueChange={onModelChange}>
            <SelectTrigger
              className={cn(
                "min-w-[156px] gap-[6px] rounded-lg border-[#E52227]/35 bg-[linear-gradient(135deg,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.03)_100%)] text-[13px] text-white/85 backdrop-blur-[12px]",
                "hover:text-white hover:shadow-[0_2px_12px_rgba(229,34,39,0.15)]"
              )}
            >
              <IconWand className="size-4 text-white/75" />
              <SelectValue placeholder={loading ? "加载模型中" : "选择模型"} />
            </SelectTrigger>
            <SelectContent className="border-white/10 bg-[#2F2F35] text-white">
              {voiceModels.map((item) => (
                <SelectItem
                  key={String(item.serviceCode ?? "")}
                  value={String(item.serviceCode ?? "")}
                >
                  {String(item.serviceName ?? item.serviceCode ?? "Unknown")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Voice Chip */}
          <button
            type="button"
            onClick={onOpenVoicePicker}
            className="relative flex min-w-[156px] max-w-[200px] items-center gap-[6px] rounded-lg bg-[linear-gradient(135deg,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.03)_100%)] px-[14px] py-[7px] text-[13px] text-white/85 backdrop-blur-[12px] transition-[transform,box-shadow,color] duration-200 hover:text-white hover:shadow-[0_2px_12px_rgba(229,34,39,0.15)]"
          >
            <span className="pointer-events-none absolute inset-0 rounded-lg border border-[#E52227]/35 opacity-70" />
            <IconMicrophone className="size-4 text-white/75" />
            <span className="flex-1 truncate text-left">
              {selectedVoiceName || t("selectVoice")}
            </span>
            {hasVoice && onClearVoice ? (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onClearVoice();
                }}
                className="flex size-5 items-center justify-center rounded-full text-white/55 hover:bg-white/10 hover:text-white"
              >
                <IconX className="size-3.5" />
              </span>
            ) : (
              <IconChevronDown className="size-4 text-white/55" />
            )}
          </button>
        </div>

        <div className="flex items-center gap-3">
          {/* Count Select */}
          <Select value={String(count)} onValueChange={(v) => onCountChange(Number(v))}>
            <SelectTrigger
              className={cn(
                "min-w-[86px] gap-[6px] rounded-lg border-[#E52227]/35 bg-[linear-gradient(135deg,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.03)_100%)] text-[13px] text-white/85 backdrop-blur-[12px]"
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-white/10 bg-[#2F2F35] text-white">
              <SelectItem value="1">1x</SelectItem>
              <SelectItem value="2">2x</SelectItem>
              <SelectItem value="4">4x</SelectItem>
            </SelectContent>
          </Select>

          {/* Generate Button */}
          <div className="relative flex items-center gap-1.5 rounded-full bg-[linear-gradient(135deg,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.03)_100%)] p-[6px_4px] backdrop-blur-[12px]">
            <span className="pointer-events-none absolute inset-0 rounded-full border border-white/10" />
            {cost > 0 && (
              <span className="relative flex h-[26px] min-w-[48px] items-center justify-center rounded-full bg-white/[0.04] px-3 text-sm font-medium text-white/80">
                {cost}
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={onSubmit}
              disabled={isGenerating}
              className={cn(
                "relative size-9 rounded-full",
                isGenerating
                  ? "bg-white/[0.05] text-white/30"
                  : "bg-[linear-gradient(135deg,rgba(229,34,39,0.7)_0%,rgba(229,34,39,0.5)_100%)] text-white shadow-[0_2px_8px_rgba(229,34,39,0.3)] hover:scale-105 hover:shadow-[0_4px_12px_rgba(229,34,39,0.4)]"
              )}
            >
              {isGenerating ? (
                <IconLoader2 className="size-[18px] animate-spin" />
              ) : (
                <IconArrowUp className="size-[18px]" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
