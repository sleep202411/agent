import { useAppSelector } from "@/src/store";
import { TaskPanel } from "./task-panel";

/** Dev fallback user ID — matches server DEV_USER.id */
const DEV_USER_ID = "62";

export function TaskPanelConnected() {
  const user = useAppSelector((s) => s.auth.user);
  const userId = user?.id ?? DEV_USER_ID;

  return <TaskPanel userId={userId} />;
}
