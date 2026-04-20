/**
 * Thin re-export barrel – keeps existing imports working after the split.
 * All implementation now lives in @/app/projects/_components/storyboard/cells/.
 */
export {
  ShotNoCell,
  DurationCell,
  RichTextCell,
  SelectCell,
  CharacterCell,
  SceneReferenceCell,
  ImageCell,
  MediaCell,
  buildMentionItems,
  renderMentionPreviewHtml,
} from "@/app/projects/_components/storyboard/cells";
