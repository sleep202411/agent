"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useAdminOperation } from "../use-admin-operation";
import { requestEnvelope, toErrorMessage } from "./shared";

/** The field is keyed by its recommendation/IP and bound media value. */
export function useDiscoveryUpload(
  assetType: "image" | "video",
  onChange: (next: { assetId: string | null; url: string }) => void,
  onPendingChange?: (pending: boolean) => void,
  disabled = false,
  open = true
) {
  const { busy: uploading, begin } = useAdminOperation(open);
  const [preview, setPreview] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const available = useRef(open && !disabled);
  const notified = useRef(false);
  const notifyRef = useRef(onPendingChange);
  useLayoutEffect(() => {
    available.current = open && !disabled;
    notifyRef.current = onPendingChange;
  });
  function notify(pending: boolean) {
    if (notified.current === pending) return;
    notified.current = pending;
    notifyRef.current?.(pending);
  }
  function releasePreview() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
  }
  useLayoutEffect(
    () => () => {
      releasePreview();
      notify(false);
    },
    [open]
  );
  async function upload(file: File) {
    if (!available.current) return;
    const operation = begin();
    if (!operation) return;
    setError(null);
    notify(true);
    try {
      releasePreview();
      previewRef.current = URL.createObjectURL(file);
      setPreview(previewRef.current);
      const form = new FormData();
      form.append("file", file);
      const data = await requestEnvelope<{
        asset: { id: string; url: string | null } | null;
      }>(`/api/admin/ip-commerce/discovery/media?kind=${assetType}`, {
        method: "POST",
        body: form,
        signal: operation.signal,
      });
      if (!operation.current()) return;
      if (!data.asset) throw new Error("上传失败");
      onChange({
        assetId: data.asset.id,
        url: `/api/admin/media/assets/${encodeURIComponent(data.asset.id)}/content?variantKey=original`,
      });
      releasePreview();
      setPreview(null);
    } catch (err) {
      if (!operation.current()) return;
      setError(toErrorMessage(err));
      releasePreview();
      setPreview(null);
    } finally {
      if (operation.current()) notify(false);
      operation.finish();
    }
  }
  function clear() {
    if (!available.current) return;
    const operation = begin();
    if (!operation) return;
    try {
      releasePreview();
      setPreview(null);
      setError(null);
      onChange({ assetId: null, url: "" });
    } finally {
      operation.finish();
    }
  }
  return { uploading, preview, error, upload, clear };
}
