"use client";
import { useCallback, useRef, useState } from "react";
import { useAdminOperation } from "../use-admin-operation";
import { toErrorMessage } from "./shared";

export function useDiscoverySave(
  onSave: (signal: AbortSignal) => Promise<void>,
  onSaved: () => void,
  open = true
) {
  const { busy: saving, begin } = useAdminOperation(open);
  const [saveError, setSaveError] = useState<string | null>(null);
  const pendingUploads = useRef(new Set<string>());
  const [uploadCount, setUploadCount] = useState(0);
  const markUpload = useCallback((field: string, pending: boolean) => {
    if (pending) pendingUploads.current.add(field);
    else pendingUploads.current.delete(field);
    setUploadCount(pendingUploads.current.size);
  }, []);
  async function save() {
    if (pendingUploads.current.size) return;
    const operation = begin();
    if (!operation) return;
    setSaveError(null);
    try {
      await onSave(operation.signal);
      if (operation.current()) onSaved();
    } catch (err) {
      if (operation.current()) setSaveError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }
  return { saving, saveError, uploadCount, markUpload, save };
}
