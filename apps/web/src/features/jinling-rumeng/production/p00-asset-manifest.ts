import manifestSource from "./manifests/s01-p00-v01.json";
import { parseJinlingAssetManifest } from "./asset-manifest";

/**
 * Parse at module load so an invalid production manifest fails tests/builds
 * before any generation runner can inspect its submission state.
 */
export const S01_P00_ASSET_MANIFEST = parseJinlingAssetManifest(manifestSource);
