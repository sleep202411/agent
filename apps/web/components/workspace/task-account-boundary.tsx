"use client";

import { useLayoutEffect } from "react";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useAppDispatch } from "@/src/store";
import { setTaskOwner } from "@/src/store/slices/taskSlice";

/** Keep task ownership current even when the task panel is not mounted. */
export function TaskAccountBoundary() {
  const { user, isFetched } = useCurrentUser();
  const dispatch = useAppDispatch();
  const ownerId = user?.id ?? null;
  useLayoutEffect(() => {
    if (isFetched) dispatch(setTaskOwner(ownerId));
  }, [isFetched, ownerId, dispatch]);
  return null;
}
