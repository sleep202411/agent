"use client";

import { useCurrentUser } from "@/src/hooks/use-user";
import { TaskPanel } from "./task-panel";

export function TaskPanelConnected() {
  const { user } = useCurrentUser();
  const userId = user?.id;
  if (!userId) return null;

  return <TaskPanel userId={userId} />;
}
