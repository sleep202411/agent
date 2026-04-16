import { IconLoader2, IconPhoto, IconTrash, IconWand } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buildOssUrl } from "@/src/lib/uploads/workspace-upload";
import type { CharacterPanelItem } from "./character-utils";

export function CharacterList({
  characters,
  loading,
  loadingMore,
  hasMore,
  selectedVersion,
  onSelectVersion,
  onFusion,
  onDelete,
  onLoadMore,
}: {
  characters: CharacterPanelItem[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  selectedVersion: string;
  onSelectVersion: (character: CharacterPanelItem) => void;
  onFusion: (character: CharacterPanelItem) => void;
  onDelete: (character: CharacterPanelItem) => void;
  onLoadMore: () => void;
}) {
  const t = useTranslations("character");
  const tc = useTranslations("common");

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="h-4 w-20 rounded bg-muted" />
              <div className="h-4 w-12 rounded bg-muted" />
            </div>
            <div className="flex gap-2">
              <div className="h-[135px] w-[120px] rounded bg-muted" />
              <div className="h-[135px] w-[120px] rounded bg-muted/70" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (characters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-14 text-sm text-muted-foreground">
        {t("noCharacters")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {characters.map((character) => {
        const variants = Object.entries(character.otherImgPath).map(([name, path]) => ({
          name,
          path,
        }));
        return (
          <div
            key={character.__panelKey}
            data-panel-key={character.__panelKey}
            className="space-y-3"
          >
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => onSelectVersion(character)}
                className="truncate text-left text-sm font-medium text-foreground transition-colors hover:text-primary"
              >
                {character.name || t("unnamedCharacter")}
              </button>

              <div className="flex items-center gap-1.5">
                {character.id ? (
                  <Button
                    type="button"
                    variant="ghost"
                    color="muted"
                    size="sm"
                    className="h-7 px-2 text-xs text-primary hover:bg-primary/10 hover:text-primary"
                    onClick={() => onFusion(character)}
                  >
                    <IconWand className="size-3.5" />
                    {t("aiFusion")}
                  </Button>
                ) : null}

                {character.id ? (
                  <Button
                    type="button"
                    variant="ghost"
                    color="muted"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => onDelete(character)}
                  >
                    <IconTrash className="size-4" />
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => onSelectVersion(character)}
                className={cn(
                  "shrink-0 rounded-md border-2 border-transparent transition-colors hover:border-primary/40",
                  selectedVersion === character.__panelKey && "border-primary"
                )}
              >
                <div className="h-[135px] w-[120px] overflow-hidden rounded-[4px] bg-[#414145]">
                  {character.roleImgPath[0] ? (
                    <img
                      src={buildOssUrl(character.roleImgPath[0])}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <IconPhoto className="size-6 text-white/25" />
                    </div>
                  )}
                </div>
                <div className="w-[120px] truncate py-1 text-center text-xs text-muted-foreground">
                  {character.name || t("unnamedCharacter")}
                </div>
              </button>

              {variants.map((variant) => (
                <button
                  key={`${character.__panelKey}_${variant.name}`}
                  type="button"
                  onClick={() => onSelectVersion(character)}
                  className="shrink-0 rounded-md border-2 border-transparent transition-colors hover:border-primary/40"
                >
                  <div className="h-[135px] w-[120px] overflow-hidden rounded-[4px] bg-[#414145]">
                    <img
                      src={buildOssUrl(variant.path)}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="w-[120px] truncate py-1 text-center text-xs text-muted-foreground">
                    {variant.name}
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}

      <div className="py-2 text-center text-xs text-muted-foreground">
        {hasMore ? (
          <Button
            variant="ghost"
            color="muted"
            size="sm"
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {tc("loadMore")}
          </Button>
        ) : (
          tc("noMoreData")
        )}
      </div>
    </div>
  );
}
