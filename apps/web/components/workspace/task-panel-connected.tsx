"use client";

import { useCurrentUser } from "@/src/hooks/use-user";
import { TaskPanel } from "./task-panel";

const DEV_USER_ID = "62";

export function TaskPanelConnected() {
  const { user } = useCurrentUser();
  const userId = user?.id ?? DEV_USER_ID;

  return <TaskPanel userId={userId} />;
}
