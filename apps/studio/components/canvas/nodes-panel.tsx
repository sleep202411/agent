"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { IconSearch } from "@tabler/icons-react";
import {
  ADD_NODE_ICONS,
  ADD_NODE_LABEL_KEYS,
  ADD_NODE_SHORTCUTS,
  DEFAULT_ADD_NODE_ACTIONS,
  type AddNodeAction,
} from "@/components/canvas/add-node-menu";
import { DrawerPanel } from "@/components/ui/drawer-panel";

interface NodesPanelProps {
  actions?: readonly AddNodeAction[];
  onAction: (action: AddNodeAction) => void;
  onClose: () => void;
}

/**
 * Searchable node catalog for product shells. Creation remains owned by the
 * active canvas; this panel only describes and dispatches supported actions.
 */
export function NodesPanel({
  actions = DEFAULT_ADD_NODE_ACTIONS,
  onAction,
  onClose,
}: NodesPanelProps) {
  const t = useTranslations("canvasControls");
  const [query, setQuery] = useState("");

  const items = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return actions
      .map((action) => ({
        action,
        label: t(`addNode.${ADD_NODE_LABEL_KEYS[action]}`),
        shortcut: ADD_NODE_SHORTCUTS[action].toUpperCase(),
        Icon: ADD_NODE_ICONS[action],
      }))
      .filter((item) => item.label.toLocaleLowerCase().includes(normalizedQuery));
  }, [actions, query, t]);

  return (
    <>
      <DrawerPanel.Header
        title={t("nodes.title")}
        closeLabel={t("nodes.close")}
        onClose={onClose}
      />

      <div className="mx-4 mb-4 flex h-11 shrink-0 items-center gap-2.5 rounded-xl bg-white/[0.065] px-3.5 focus-within:bg-white/[0.09]">
        <IconSearch className="size-[18px] shrink-0 text-white/44" stroke={1.7} />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("addNode.searchPlaceholder")}
          aria-label={t("addNode.searchPlaceholder")}
          className="min-w-0 flex-1 bg-transparent text-sm text-white/88 outline-none placeholder:text-white/34"
        />
      </div>

      <DrawerPanel.Body className="px-3 pb-4">
        <p className="px-2 pb-2 text-[11px] font-semibold tracking-[0.09em] text-white/38 uppercase">
          {t("nodes.add")}
        </p>

        <div className="space-y-1">
          {items.map(({ action, label, shortcut, Icon }) => (
            <button
              key={action}
              type="button"
              onClick={() => onAction(action)}
              className="group flex min-h-14 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-white/[0.065] focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.08] text-white/66 transition-colors group-hover:bg-white/[0.12] group-hover:text-white">
                <Icon className="size-5" stroke={1.55} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-white/88">
                {label}
              </span>
              <kbd className="pr-1 text-xs text-white/34">{shortcut}</kbd>
            </button>
          ))}
        </div>

        {items.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-white/38">{t("addNode.noMatches")}</p>
        ) : null}
      </DrawerPanel.Body>
    </>
  );
}
