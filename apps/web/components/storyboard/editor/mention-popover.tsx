import type { CSSProperties, RefObject } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "@/src/i18n/i18n";
import { IconBox, IconLoader2, IconPhoto, IconUser } from "@tabler/icons-react";
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
  tc: (key: string) => string;
  tScene: (key: string) => string;
  tProp: (key: string) => string;
}

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
  tc,
  tScene,
  tProp,
}: MentionPopoverProps) {
  const t = useTranslations("storyboard");
  const renderLoadingSection = (prefix: string) => (
    <div className="mt-3 flex flex-wrap gap-2 first:mt-0">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={`${prefix}-${index}`} className="w-[100px] rounded-lg bg-[#333333] p-1.5">
          <div className="aspect-square animate-pulse rounded-md bg-[#444444]" />
          <div className="mx-auto mt-2 h-3 w-12 animate-pulse rounded bg-[#444444]" />
        </div>
      ))}
    </div>
  );

  return createPortal(
    <div
      ref={popoverRef}
      style={popoverStyle}
      className="fixed z-[2100] rounded-lg border border-[#404040] bg-[#2a2a2a] shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
    >
      <div className="p-3">
        <div className="mb-2 flex items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-2">
            {searchQuery ? (
              <span className="text-[13px] font-medium text-primary">
                {t("search")}: {searchQuery}
              </span>
            ) : null}
            {isSearching ? (
              <IconLoader2 className="size-3.5 animate-spin text-muted-foreground" />
            ) : null}
          </div>
          <span className="text-[12px] text-[#666666]">{t("mentionHelp")}</span>
        </div>

        <div className="max-h-[360px] overflow-auto">
          {activeMentionTypes.includes("character") &&
          (loadingCharacters || characterDisplayGroups.length > 0) ? (
            <div className="mt-3 first:mt-0">
              {!loadingCharacters ? null : renderLoadingSection("character")}
              {!loadingCharacters &&
                characterDisplayGroups.map((group) => (
                  <div key={group.id} className="mt-3 first:mt-0">
                    <div className="mb-3 px-1 text-sm font-medium text-[#999999]">{group.name}</div>
                    <div className="flex flex-wrap gap-2">
                      {group.items.map((item) => {
                        const index = flattenedItems.findIndex(
                          (entry) =>
                            entry.mentionType === "character" &&
                            entry.id === group.id &&
                            entry.imgUrl === item.imgUrl
                        );
                        const disabled = isCharacterDisabled(group);
                        return (
                          <button
                            key={item.key}
                            type="button"
                            disabled={disabled}
                            onClick={() => {
                              const selected = flattenedItems[index];
                              if (selected) onSelectMention(selected);
                            }}
                            className={cn(
                              "w-[100px] rounded-lg border-2 border-transparent bg-[#333333] p-1.5 text-left transition-all hover:border-primary hover:bg-[#3a3a3a]",
                              index === selectedIndex && "border-primary bg-primary/15",
                              disabled &&
                                "cursor-not-allowed opacity-45 hover:border-transparent hover:bg-[#333333]"
                            )}
                          >
                            <div className="aspect-square overflow-hidden rounded-md bg-[#444444]">
                              {item.imgUrl ? (
                                <img
                                  src={item.imgUrl}
                                  alt=""
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="flex h-full items-center justify-center text-[#666666]">
                                  <IconUser className="size-6" />
                                </div>
                              )}
                            </div>
                            <div className="mt-1.5 truncate text-center text-[12px] text-[#cccccc]">
                              {group.name}
                            </div>
                            {disabled ? (
                              <div className="mt-0.5 text-center text-[11px] text-[#888888]">
                                {t("voiceNotConfigured")}
                              </div>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              {!loadingCharacters && hasMoreCharacters ? (
                <div className="py-2 text-center">
                  <Button
                    type="button"
                    variant="ghost"
                    color="muted"
                    size="sm"
                    onClick={() => void onLoadMoreCharacters()}
                    disabled={loadingMoreCharacters}
                    className="text-xs text-muted-foreground"
                  >
                    {loadingMoreCharacters ? tc("loading") : tc("loadMore")}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {activeMentionTypes.includes("scene") && (loadingScenes || scenes.length > 0) ? (
            <div className="mt-3 first:mt-0">
              <div className="mb-3 px-1 text-sm font-medium text-[#999999]">{tScene("title")}</div>
              {loadingScenes ? (
                renderLoadingSection("scene")
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    {scenes.map((scene) => {
                      const index = flattenedItems.findIndex(
                        (entry) => entry.mentionType === "scene" && entry.id === scene.id
                      );
                      return (
                        <button
                          key={scene.id}
                          type="button"
                          onClick={() => {
                            const selected = flattenedItems[index];
                            if (selected) onSelectMention(selected);
                          }}
                          className={cn(
                            "w-[100px] rounded-lg border-2 border-transparent bg-[#333333] p-1.5 text-left transition-all hover:border-primary hover:bg-[#3a3a3a]",
                            index === selectedIndex && "border-primary bg-primary/15"
                          )}
                        >
                          <div className="aspect-square overflow-hidden rounded-md bg-[#444444]">
                            {scene.imgUrl ? (
                              <img
                                src={scene.imgUrl}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full items-center justify-center text-[#666666]">
                                <IconPhoto className="size-6" />
                              </div>
                            )}
                          </div>
                          <div className="mt-1.5 truncate text-center text-[12px] text-[#cccccc]">
                            {scene.name}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {hasMoreScenes ? (
                    <div className="py-2 text-center">
                      <Button
                        type="button"
                        variant="ghost"
                        color="muted"
                        size="sm"
                        onClick={() => void onLoadMoreScenes()}
                        disabled={loadingMoreScenes}
                        className="text-xs text-muted-foreground"
                      >
                        {loadingMoreScenes ? tc("loading") : tc("loadMore")}
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          {activeMentionTypes.includes("prop") && (loadingProps || propsList.length > 0) ? (
            <div className="mt-3 first:mt-0">
              <div className="mb-3 px-1 text-sm font-medium text-[#999999]">{tProp("title")}</div>
              {loadingProps ? (
                renderLoadingSection("prop")
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    {propsList.map((prop) => {
                      const index = flattenedItems.findIndex(
                        (entry) => entry.mentionType === "prop" && entry.id === prop.id
                      );
                      return (
                        <button
                          key={prop.id}
                          type="button"
                          onClick={() => {
                            const selected = flattenedItems[index];
                            if (selected) onSelectMention(selected);
                          }}
                          className={cn(
                            "w-[100px] rounded-lg border-2 border-transparent bg-[#333333] p-1.5 text-left transition-all hover:border-primary hover:bg-[#3a3a3a]",
                            index === selectedIndex && "border-primary bg-primary/15"
                          )}
                        >
                          <div className="aspect-square overflow-hidden rounded-md bg-[#444444]">
                            {prop.imgUrl ? (
                              <img
                                src={prop.imgUrl}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full items-center justify-center text-[#666666]">
                                <IconBox className="size-6" />
                              </div>
                            )}
                          </div>
                          <div className="mt-1.5 truncate text-center text-[12px] text-[#cccccc]">
                            {prop.name}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {hasMoreProps ? (
                    <div className="py-2 text-center">
                      <Button
                        type="button"
                        variant="ghost"
                        color="muted"
                        size="sm"
                        onClick={() => void onLoadMoreProps()}
                        disabled={loadingMoreProps}
                        className="text-xs text-muted-foreground"
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
            <div className="px-3 py-6 text-center text-[13px] text-[#666666]">{tc("noData")}</div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}
