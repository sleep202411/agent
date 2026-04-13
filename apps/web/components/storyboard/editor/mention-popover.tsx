import { useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "@/src/i18n/i18n";
import {
  IconBox,
  IconChevronRight,
  IconLoader2,
  IconPhoto,
  IconUser,
  IconVideo,
  IconPaperclip,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MentionFlatItem } from "./mention-editor-utils";
import type { MentionType } from "./mention-node";

interface CharacterDisplayGroup {
  id: string;
  name: string;
  voiceId?: string;
  model?: string;
  items: Array<{ key: string; imgUrl: string }>;
}

interface MentionSearchItem {
  id: string;
  name: string;
  imgUrl?: string;
}

export interface ReferenceMediaItem {
  url: string;
  path: string;
  label?: string;
}

export interface MentionPopoverProps {
  popoverRef: RefObject<HTMLDivElement | null>;
  popoverStyle: CSSProperties;
  searchQuery: string;
  isSearching: boolean;
  activeMentionTypes: MentionType[];
  selectedIndex: number;
  flattenedItems: MentionFlatItem[];
  characterDisplayGroups: CharacterDisplayGroup[];
  scenes: MentionSearchItem[];
  propsList: MentionSearchItem[];
  loadingCharacters: boolean;
  loadingScenes: boolean;
  loadingProps: boolean;
  hasMoreCharacters: boolean;
  hasMoreScenes: boolean;
  hasMoreProps: boolean;
  loadingMoreCharacters: boolean;
  loadingMoreScenes: boolean;
  loadingMoreProps: boolean;
  isCharacterDisabled: (item: { voiceId?: string; model?: string }) => boolean;
  onSelectMention: (item: MentionFlatItem) => void;
  onLoadMoreCharacters: () => void;
  onLoadMoreScenes: () => void;
  onLoadMoreProps: () => void;
  /** Reference group media items (images/videos uploaded as reference) */
  referenceMedia?: ReferenceMediaItem[];
  onSelectReferenceMedia?: (item: ReferenceMediaItem) => void;
  tc: (key: string) => string;
  tScene: (key: string) => string;
  tProp: (key: string) => string;
}

// ─── Compact row item ─────────────────────────────────

function CompactItem({
  imgUrl,
  icon,
  label,
  selected,
  disabled,
  disabledHint,
  suffix,
  onClick,
  onContextMenu,
}: {
  imgUrl?: string;
  icon?: React.ReactNode;
  label: string;
  selected?: boolean;
  disabled?: boolean;
  disabledHint?: string;
  suffix?: React.ReactNode;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors",
        selected ? "bg-primary/15 text-[#e0e0e0]" : "text-[#cccccc] hover:bg-[#3a3a3a]",
        disabled && "cursor-not-allowed opacity-45 hover:bg-transparent"
      )}
    >
      <div className="size-7 shrink-0 overflow-hidden rounded-md bg-[#444444]">
        {imgUrl ? (
          <img src={imgUrl} alt="" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-[#666666]">
            {icon ?? <IconUser className="size-3.5" />}
          </div>
        )}
      </div>
      <span className="min-w-0 truncate text-[13px]">{label}</span>
      {disabled && disabledHint ? (
        <span className="ml-auto shrink-0 text-[11px] text-[#666666]">{disabledHint}</span>
      ) : null}
      {suffix}
    </button>
  );
}

// ─── Section header ───────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 mt-3 px-2 text-[11px] font-semibold uppercase tracking-wide text-[#777777] first:mt-0">
      {children}
    </div>
  );
}

// ─── Main component ───────────────────────────────────

export function MentionPopover({
  popoverRef,
  popoverStyle,
  searchQuery,
  isSearching,
  activeMentionTypes,
  selectedIndex,
  flattenedItems,
  characterDisplayGroups,
  scenes,
  propsList,
  loadingCharacters,
  loadingScenes,
  loadingProps,
  hasMoreCharacters,
  hasMoreScenes,
  hasMoreProps,
  loadingMoreCharacters,
  loadingMoreScenes,
  loadingMoreProps,
  isCharacterDisabled,
  onSelectMention,
  onLoadMoreCharacters,
  onLoadMoreScenes,
  onLoadMoreProps,
  referenceMedia,
  onSelectReferenceMedia,
  tc,
  tScene,
  tProp,
}: MentionPopoverProps) {
  const t = useTranslations("storyboard");
  const [expandedCharId, setExpandedCharId] = useState<string | null>(null);

  const isVideo = (path: string) => /\.(mp4|webm|mov)(\?|$)/i.test(path);

  return createPortal(
    <div
      ref={popoverRef}
      style={popoverStyle}
      className="fixed z-[2100] rounded-lg border border-[#404040] bg-[#2a2a2a] shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
    >
      <div className="p-2">
        <div className="mb-1.5 flex items-center justify-between gap-3 px-2">
          <div className="flex items-center gap-2">
            {searchQuery ? (
              <span className="text-[12px] font-medium text-primary">
                {t("search")}: {searchQuery}
              </span>
            ) : null}
            {isSearching ? (
              <IconLoader2 className="size-3 animate-spin text-muted-foreground" />
            ) : null}
          </div>
          <span className="text-[11px] text-[#555555]">{t("mentionHelp")}</span>
        </div>

        <div
          className="max-h-[400px] overflow-auto overscroll-contain"
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          {/* Reference media (images/videos from reference group) */}
          {(() => {
            const refItems = flattenedItems.filter((f) => f.mentionType === "reference");
            if (refItems.length === 0) return null;
            return (
              <div>
                <SectionHeader>
                  <IconPaperclip className="mb-px mr-1 inline size-3" />
                  {t("referenceMedia")}
                </SectionHeader>
                {refItems.map((item) => {
                  const index = flattenedItems.indexOf(item);
                  return (
                    <CompactItem
                      key={item.key}
                      imgUrl={item.imgUrl}
                      icon={
                        isVideo(item.id) ? (
                          <IconVideo className="size-3.5" />
                        ) : (
                          <IconPhoto className="size-3.5" />
                        )
                      }
                      label={item.name}
                      selected={index === selectedIndex}
                      onClick={() => onSelectMention(item)}
                    />
                  );
                })}
              </div>
            );
          })()}

          {/* Characters */}
          {activeMentionTypes.includes("character") &&
          (loadingCharacters || characterDisplayGroups.length > 0) ? (
            <div>
              <SectionHeader>
                <IconUser className="mb-px mr-1 inline size-3" />
                {tc("character")}
              </SectionHeader>
              {loadingCharacters ? (
                <div className="flex items-center gap-2 px-2 py-3">
                  <IconLoader2 className="size-3.5 animate-spin text-[#666666]" />
                  <span className="text-[12px] text-[#666666]">{tc("loading")}</span>
                </div>
              ) : (
                characterDisplayGroups.map((group) => {
                  const disabled = isCharacterDisabled(group);
                  const hasVariants = group.items.length > 1;
                  const isExpanded = expandedCharId === group.id;
                  const firstItem = group.items[0];
                  const firstIndex = flattenedItems.findIndex(
                    (entry) =>
                      entry.mentionType === "character" &&
                      entry.id === group.id &&
                      entry.imgUrl === firstItem.imgUrl
                  );

                  // Collapsed: show first image only
                  if (!isExpanded) {
                    return (
                      <CompactItem
                        key={firstItem.key}
                        imgUrl={firstItem.imgUrl}
                        label={group.name}
                        selected={firstIndex === selectedIndex}
                        disabled={disabled}
                        disabledHint={disabled ? t("voiceNotConfigured") : undefined}
                        suffix={
                          hasVariants ? (
                            <IconChevronRight className="ml-auto size-3.5 shrink-0 text-[#666666]" />
                          ) : undefined
                        }
                        onClick={() => {
                          const sel = flattenedItems[firstIndex];
                          if (sel) onSelectMention(sel);
                        }}
                        onContextMenu={
                          hasVariants
                            ? (e) => {
                                e.preventDefault();
                                setExpandedCharId(group.id);
                              }
                            : undefined
                        }
                      />
                    );
                  }

                  // Expanded: show all variants
                  return (
                    <div key={group.id} className="rounded-lg bg-[#333333]/60">
                      {group.items.map((item) => {
                        const index = flattenedItems.findIndex(
                          (entry) =>
                            entry.mentionType === "character" &&
                            entry.id === group.id &&
                            entry.imgUrl === item.imgUrl
                        );
                        return (
                          <CompactItem
                            key={item.key}
                            imgUrl={item.imgUrl}
                            label={group.name}
                            selected={index === selectedIndex}
                            disabled={disabled}
                            disabledHint={disabled ? t("voiceNotConfigured") : undefined}
                            onClick={() => {
                              const sel = flattenedItems[index];
                              if (sel) onSelectMention(sel);
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              setExpandedCharId(null);
                            }}
                          />
                        );
                      })}
                    </div>
                  );
                })
              )}
              {!loadingCharacters && hasMoreCharacters ? (
                <div className="py-1 text-center">
                  <Button
                    type="button"
                    variant="ghost"
                    color="muted"
                    size="sm"
                    onClick={() => void onLoadMoreCharacters()}
                    disabled={loadingMoreCharacters}
                    className="text-[11px] text-[#666666]"
                  >
                    {loadingMoreCharacters ? tc("loading") : tc("loadMore")}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Scenes */}
          {activeMentionTypes.includes("scene") && (loadingScenes || scenes.length > 0) ? (
            <div>
              <SectionHeader>
                <IconPhoto className="mb-px mr-1 inline size-3" />
                {tScene("title")}
              </SectionHeader>
              {loadingScenes ? (
                <div className="flex items-center gap-2 px-2 py-3">
                  <IconLoader2 className="size-3.5 animate-spin text-[#666666]" />
                  <span className="text-[12px] text-[#666666]">{tc("loading")}</span>
                </div>
              ) : (
                <>
                  {scenes.map((scene) => {
                    const index = flattenedItems.findIndex(
                      (entry) => entry.mentionType === "scene" && entry.id === scene.id
                    );
                    return (
                      <CompactItem
                        key={scene.id}
                        imgUrl={scene.imgUrl}
                        icon={<IconPhoto className="size-3.5" />}
                        label={scene.name}
                        selected={index === selectedIndex}
                        onClick={() => {
                          const selected = flattenedItems[index];
                          if (selected) onSelectMention(selected);
                        }}
                      />
                    );
                  })}
                  {hasMoreScenes ? (
                    <div className="py-1 text-center">
                      <Button
                        type="button"
                        variant="ghost"
                        color="muted"
                        size="sm"
                        onClick={() => void onLoadMoreScenes()}
                        disabled={loadingMoreScenes}
                        className="text-[11px] text-[#666666]"
                      >
                        {loadingMoreScenes ? tc("loading") : tc("loadMore")}
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          {/* Props */}
          {activeMentionTypes.includes("prop") && (loadingProps || propsList.length > 0) ? (
            <div>
              <SectionHeader>
                <IconBox className="mb-px mr-1 inline size-3" />
                {tProp("title")}
              </SectionHeader>
              {loadingProps ? (
                <div className="flex items-center gap-2 px-2 py-3">
                  <IconLoader2 className="size-3.5 animate-spin text-[#666666]" />
                  <span className="text-[12px] text-[#666666]">{tc("loading")}</span>
                </div>
              ) : (
                <>
                  {propsList.map((prop) => {
                    const index = flattenedItems.findIndex(
                      (entry) => entry.mentionType === "prop" && entry.id === prop.id
                    );
                    return (
                      <CompactItem
                        key={prop.id}
                        imgUrl={prop.imgUrl}
                        icon={<IconBox className="size-3.5" />}
                        label={prop.name}
                        selected={index === selectedIndex}
                        onClick={() => {
                          const selected = flattenedItems[index];
                          if (selected) onSelectMention(selected);
                        }}
                      />
                    );
                  })}
                  {hasMoreProps ? (
                    <div className="py-1 text-center">
                      <Button
                        type="button"
                        variant="ghost"
                        color="muted"
                        size="sm"
                        onClick={() => void onLoadMoreProps()}
                        disabled={loadingMoreProps}
                        className="text-[11px] text-[#666666]"
                      >
                        {loadingMoreProps ? tc("loading") : tc("loadMore")}
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          {!loadingCharacters && !loadingScenes && !loadingProps && flattenedItems.length === 0 ? (
            <div className="px-3 py-6 text-center text-[12px] text-[#666666]">{tc("noData")}</div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}
