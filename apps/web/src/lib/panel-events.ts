/**
 * Cross-feature event bus for focusing an asset panel from outside the project view
 * (e.g. from a storyboard cell). Kept here so non-project code can dispatch without
 * reaching into the project feature's private tree.
 */

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
