"use client";

import { useCallback, type Ref, type RefObject } from "react";

type UserRef<T> = Ref<T> | undefined;

function updateRef<T>(ref: UserRef<T>, value: T | null) {
  if (typeof ref === "function") return ref(value);
  if (ref) ref.current = value;
}

export const useComposedRef = <T extends HTMLElement>(
  libRef: RefObject<T | null>,
  userRef: UserRef<T>
) =>
  useCallback(
    (instance: T | null) => {
      libRef.current = instance;
      const cleanup = updateRef(userRef, instance);
      if (instance === null) return;
      return () => {
        libRef.current = null;
        if (typeof cleanup === "function") cleanup();
        else updateRef(userRef, null);
      };
    },
    [libRef, userRef]
  );

export default useComposedRef;
