import type { TextGameDetail, TextGameUpdateInput } from "@repo/shared/text-game";

export interface TextAdventureDraftForm {
  name: string;
  synopsis: string;
  posterUrl: string;
  worldviewDocxUrl: string;
  bgmUrl: string;
  stillUrls: string[];
}

export function textAdventureDraftFormFromDetail(game: TextGameDetail): TextAdventureDraftForm {
  return {
    name: game.content.name ?? "",
    synopsis: game.content.synopsis ?? "",
    posterUrl: game.content.posterUrl ?? "",
    worldviewDocxUrl: game.content.worldviewDocxUrl ?? "",
    bgmUrl: game.content.bgmUrl ?? "",
    stillUrls: game.content.stillUrls,
  };
}

export function toTextAdventureUpdateInput(
  form: TextAdventureDraftForm,
  baseline: TextAdventureDraftForm
): TextGameUpdateInput {
  const input: TextGameUpdateInput = {};
  if (form.name !== baseline.name) input.name = form.name.trim();
  if (form.synopsis !== baseline.synopsis) input.synopsis = form.synopsis.trim();
  if (form.posterUrl !== baseline.posterUrl && form.posterUrl) input.posterUrl = form.posterUrl;
  if (form.worldviewDocxUrl !== baseline.worldviewDocxUrl && form.worldviewDocxUrl) {
    input.worldviewDocxUrl = form.worldviewDocxUrl;
  }
  if (form.bgmUrl !== baseline.bgmUrl) input.bgmUrl = form.bgmUrl;
  if (!sameStringList(form.stillUrls, baseline.stillUrls)) input.stillUrls = form.stillUrls;
  return input;
}

function sameStringList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
