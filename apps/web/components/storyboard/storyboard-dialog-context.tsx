import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useAppSelector } from "@/src/store";
import { selectCurrentInstance } from "@/src/store/slices/projectSlice";

export interface DialogTarget {
  shotId: string;
  shotColumnId: string;
}

interface StoryboardDialogContextValue {
  imageTarget: DialogTarget | null;
  videoTarget: DialogTarget | null;
  openImageDialog: (shotId: string, shotColumnId: string) => void;
  openVideoDialog: (shotId: string, shotColumnId: string) => void;
  closeImageDialog: () => void;
  closeVideoDialog: () => void;
  navigateShot: (direction: -1 | 1) => void;
}

const StoryboardDialogContext = createContext<StoryboardDialogContextValue | null>(null);

export function useStoryboardDialog() {
  const ctx = useContext(StoryboardDialogContext);
  if (!ctx) throw new Error("useStoryboardDialog must be used within StoryboardDialogProvider");
  return ctx;
}

export function StoryboardDialogProvider({ children }: { children: ReactNode }) {
  const [imageTarget, setImageTarget] = useState<DialogTarget | null>(null);
  const [videoTarget, setVideoTarget] = useState<DialogTarget | null>(null);
  const rows = useAppSelector((s) => selectCurrentInstance(s).rows);

  const openImageDialog = useCallback(
    (shotId: string, shotColumnId: string) => setImageTarget({ shotId, shotColumnId }),
    []
  );
  const openVideoDialog = useCallback(
    (shotId: string, shotColumnId: string) => setVideoTarget({ shotId, shotColumnId }),
    []
  );
  const closeImageDialog = useCallback(() => setImageTarget(null), []);
  const closeVideoDialog = useCallback(() => setVideoTarget(null), []);

  const navigateShot = useCallback(
    (direction: -1 | 1) => {
      const activeTarget = imageTarget ?? videoTarget;
      if (!activeTarget) return;

      const currentIndex = rows.findIndex((r) => r.shotId === activeTarget.shotId);
      if (currentIndex === -1) return;

      const nextIndex = currentIndex + direction;
      if (nextIndex < 0 || nextIndex >= rows.length) return;

      const nextShot = rows[nextIndex];
      if (!nextShot?.shotId) return;

      const nextTarget = {
        shotId: String(nextShot.shotId),
        shotColumnId: activeTarget.shotColumnId,
      };
      if (imageTarget) setImageTarget(nextTarget);
      if (videoTarget) setVideoTarget(nextTarget);
    },
    [imageTarget, videoTarget, rows]
  );

  const value = useMemo<StoryboardDialogContextValue>(
    () => ({
      imageTarget,
      videoTarget,
      openImageDialog,
      openVideoDialog,
      closeImageDialog,
      closeVideoDialog,
      navigateShot,
    }),
    [
      imageTarget,
      videoTarget,
      openImageDialog,
      openVideoDialog,
      closeImageDialog,
      closeVideoDialog,
      navigateShot,
    ]
  );

  return <StoryboardDialogContext value={value}>{children}</StoryboardDialogContext>;
}
