import { useTranslations } from "@/src/i18n/i18n";
import { IconLoader2 } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { PropCard } from "./prop-card";
import type { PropPanelItem } from "./prop-utils";

export function PropList({
  props,
  onEdit,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  props: PropPanelItem[];
  onEdit: (prop: PropPanelItem) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const t = useTranslations("prop");
  const tc = useTranslations("common");

  if (props.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
        {t("noProps")}
      </div>
    );
  }

  return (
    <div className="@container space-y-3">
      <div className="grid grid-cols-2 gap-3 @[500px]:grid-cols-3 @[700px]:grid-cols-4">
        {props.map((prop) => (
          <PropCard key={prop.__panelKey} prop={prop} onEdit={() => onEdit(prop)} />
        ))}
      </div>
      {hasMore && (
        <Button
          variant="ghost"
          color="muted"
          className="w-full"
          onClick={onLoadMore}
          disabled={loadingMore}
        >
          {loadingMore && <IconLoader2 className="size-3.5 animate-spin" />}
          {tc("loadMore")}
        </Button>
      )}
    </div>
  );
}
