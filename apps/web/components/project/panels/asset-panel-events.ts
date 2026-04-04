"use client";

export type AssetPanelTarget = "characters" | "scenes" | "props";

export interface AssetPanelFocusDetail {
  panel: AssetPanelTarget;
  assetId?: string;
  assetName?: string;
  openEditor?: boolean;
}

export const WORKSPACE_FOCUS_ASSET_PANEL_EVENT = "workspace:focus-asset-panel";

export function dispatchFocusAssetPanel(detail: AssetPanelFocusDetail) {
  window.dispatchEvent(
    new CustomEvent<AssetPanelFocusDetail>(WORKSPACE_FOCUS_ASSET_PANEL_EVENT, { detail })
  );
}
