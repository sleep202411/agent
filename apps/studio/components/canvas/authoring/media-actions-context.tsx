"use client";

import { createContext, useContext, type ReactNode } from "react";
import { ToolbarButton } from "./node-toolbar";

export interface CanvasMediaDescriptor {
  nodeId: string;
  mediaAssetId: string;
  kind: "image" | "video" | "audio";
  url: string;
  label?: string;
}

export interface CanvasMediaAction {
  id: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
  pending?: boolean;
  onSelect: () => void;
}

export type CanvasMediaActionsResolver = (
  media: CanvasMediaDescriptor
) => readonly CanvasMediaAction[];

const CanvasMediaActionsContext = createContext<CanvasMediaActionsResolver | null>(null);

export const CanvasMediaActionsProvider = CanvasMediaActionsContext.Provider;

export function useCanvasMediaActions(media: CanvasMediaDescriptor | null) {
  const resolve = useContext(CanvasMediaActionsContext);
  return resolve && media ? resolve(media) : [];
}

export function CanvasMediaToolbarActions({ media }: { media: CanvasMediaDescriptor | null }) {
  const actions = useCanvasMediaActions(media);
  return actions.map((action) => (
    <ToolbarButton
      key={action.id}
      label={action.label}
      pressed={action.active}
      disabled={action.pending}
      onClick={action.onSelect}
    >
      {action.icon}
    </ToolbarButton>
  ));
}
