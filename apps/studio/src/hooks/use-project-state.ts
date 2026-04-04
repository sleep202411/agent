import { useAppSelector } from "@/src/store";
import {
  selectCurrentInstance,
  selectCurrentProjectId,
  type ProjectInstanceState,
} from "@/src/store/slices/projectSlice";

/**
 * Convenience hook that returns the current project ID and all
 * fields from the active project instance.
 *
 * When no project is selected, returns EMPTY_INSTANCE fields
 * (stable reference, no re-renders).
 */
export function useProjectState(): { projectId: string | null } & ProjectInstanceState {
  const projectId = useAppSelector(selectCurrentProjectId);
  const instance = useAppSelector(selectCurrentInstance);
  return { projectId, ...instance };
}
