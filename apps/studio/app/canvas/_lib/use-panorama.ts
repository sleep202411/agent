import type { FizzAiCatalog, FizzAiModel } from "./generation-api";

/** The catalog's panorama (image→panorama) model, if one is configured. Used by
 *  the Panorama operation (operation-confirm-bar's PANORAMA_OP) to resolve the
 *  model an image→720° run binds to. */
export function findPanoramaModel(catalog: FizzAiCatalog | undefined): FizzAiModel | undefined {
  return (
    catalog?.models.find((m) => m.generationModes?.includes("image_to_panorama")) ??
    catalog?.models.find((m) => /hunyuan|panorama|world/i.test(m.id))
  );
}
