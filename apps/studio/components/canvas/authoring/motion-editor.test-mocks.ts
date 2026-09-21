export const useTranslations = () => (key: string) => key;
export const useStore = (fn: any) => fn({ transform: [0, 0, 1] });
export const useAiCatalog = () => ({ data: null });
export const MOTION_OP = { findModel: () => null };
export const useSpawnOperationResult = () => () => {};
export const estimateModelSellPoints = () => 0;
export const cn = (...args: any[]) => args.filter(Boolean).join(" ");
export const toast = { error: () => {} };
export const isUploadAbort = () => false;
export const uploadFileViaSignedUrl = () => {
  throw Error("unexpected upload");
};
export const IconArrowUp = () => null;
export const IconBolt = IconArrowUp,
  IconBrush = IconArrowUp,
  IconEraser = IconArrowUp,
  IconLoader2 = IconArrowUp,
  IconRefresh = IconArrowUp,
  IconRoute = IconArrowUp,
  IconX = IconArrowUp;
