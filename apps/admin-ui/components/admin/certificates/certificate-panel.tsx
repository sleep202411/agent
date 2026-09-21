"use client";

import { type ChangeEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { useAdminOperation } from "../use-admin-operation";
import {
  IconCertificate,
  IconCopy,
  IconEdit,
  IconPhoto,
  IconPlus,
  IconRefresh,
  IconRotateClockwise,
  IconSearch,
  IconTrash,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  ErrorBanner,
  formatDate,
  Metric,
  PageHeader,
  requestEnvelope,
  StatusPill,
  toErrorMessage,
} from "./shared";
import type {
  AdminCertificateRow,
  AdminCertificatesData,
  AdminCertificateStatusFilter,
} from "./types";

type Draft = {
  userId: string;
  title: string;
  issuer: string;
  credentialType: string;
  certNo: string; // optional full number; "" → server auto-generates
  issuedAt: string; // datetime-local; "" → server defaults to now (create)
  imageAssetId: string;
  imageUrl: string;
};

const EMPTY_DRAFT: Draft = {
  userId: "",
  title: "",
  issuer: "FizzDragon",
  credentialType: "general",
  certNo: "",
  issuedAt: "",
  imageAssetId: "",
  imageUrl: "",
};

export function CertificatesPanel({
  siteLabel,
  databaseLabel,
  initialData,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialData: AdminCertificatesData | null;
  initialError: string | null;
}) {
  const pageSize = initialData?.pageSize ?? 20;

  const [items, setItems] = useState<AdminCertificateRow[]>(initialData?.items ?? []);
  const [total, setTotal] = useState(initialData?.total ?? 0);
  const [page, setPage] = useState(initialData?.page ?? 1);
  const [userIdFilter, setUserIdFilter] = useState("");
  const [certNoFilter, setCertNoFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<AdminCertificateStatusFilter>("all");
  const { busy: loading, begin } = useAdminOperation();
  const [error, setError] = useState<string | null>(initialError);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const saving = loading;
  const [formError, setFormError] = useState<string | null>(null);

  const [revokeTarget, setRevokeTarget] = useState<AdminCertificateRow | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const revoking = loading;
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageActive = useMemo(() => items.filter((row) => !row.revokedAt).length, [items]);
  const pageRevoked = items.length - pageActive;

  async function readPage(targetPage: number, signal: AbortSignal) {
    const params = new URLSearchParams({ page: String(targetPage), pageSize: String(pageSize) });
    if (userIdFilter.trim()) params.set("userId", userIdFilter.trim());
    if (certNoFilter.trim()) params.set("certNo", certNoFilter.trim());
    if (statusFilter !== "all") params.set("status", statusFilter);
    return requestEnvelope<AdminCertificatesData>(`/api/admin/certificates?${params.toString()}`, {
      signal,
    });
  }
  function acceptPage(data: AdminCertificatesData) {
    setItems(data.items);
    setTotal(data.total);
    setPage(data.page);
  }
  async function refresh(targetPage = page) {
    const operation = begin("read");
    if (!operation) return;
    setError(null);
    try {
      const data = await readPage(targetPage, operation.signal);
      if (operation.current()) acceptPage(data);
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }

  function openCreate() {
    if (loading) return;
    setMode("create");
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setFormError(null);
    setSheetOpen(true);
  }

  function openEdit(row: AdminCertificateRow) {
    if (loading) return;
    setMode("edit");
    setEditingId(row.id);
    setDraft({
      userId: row.userId,
      title: row.title,
      issuer: row.issuer,
      credentialType: row.credentialType,
      certNo: "",
      issuedAt: isoToLocalInput(row.issuedAt),
      imageAssetId: row.imageAssetId,
      imageUrl: adminMediaContentUrl(row.imageAssetId) ?? row.imageUrl ?? "",
    });
    setFormError(null);
    setSheetOpen(true);
  }

  async function saveDraft() {
    setFormError(null);
    if (!draft.imageAssetId) {
      setFormError("请先上传证书图片。");
      return;
    }
    if (mode === "create" && !draft.userId.trim()) {
      setFormError("请输入用户 ID。");
      return;
    }
    if (!draft.title.trim()) {
      setFormError("请输入证书标题。");
      return;
    }

    const operation = begin();
    if (!operation) return;
    try {
      if (mode === "create") {
        const payload = {
          userId: draft.userId.trim(),
          title: draft.title.trim(),
          issuer: draft.issuer.trim() || "FizzDragon",
          credentialType: draft.credentialType,
          ...(draft.certNo.trim() ? { certNo: draft.certNo.trim().toUpperCase() } : {}),
          imageAssetId: draft.imageAssetId,
          ...(draft.issuedAt ? { issuedAt: localInputToIso(draft.issuedAt) } : {}),
        };
        await requestEnvelope("/api/admin/certificates", {
          method: "POST",
          signal: operation.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else if (editingId) {
        const payload = {
          title: draft.title.trim(),
          issuer: draft.issuer.trim() || "FizzDragon",
          credentialType: draft.credentialType,
          imageAssetId: draft.imageAssetId,
          ...(draft.issuedAt ? { issuedAt: localInputToIso(draft.issuedAt) } : {}),
        };
        await requestEnvelope(`/api/admin/certificates/${encodeURIComponent(editingId)}`, {
          method: "PATCH",
          signal: operation.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      if (!operation.current()) return;
      setSheetOpen(false);
      const data = await readPage(mode === "create" ? 1 : page, operation.signal);
      if (operation.current()) acceptPage(data);
    } catch (err) {
      if (operation.current()) {
        setFormError(toErrorMessage(err));
        setError(toErrorMessage(err));
      }
    } finally {
      operation.finish();
    }
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    const operation = begin();
    if (!operation) return;
    setRevokeError(null);
    try {
      await requestEnvelope(
        `/api/admin/certificates/${encodeURIComponent(revokeTarget.id)}/revoke`,
        {
          method: "POST",
          signal: operation.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: revokeReason.trim() || null }),
        }
      );
      if (!operation.current()) return;
      setRevokeTarget(null);
      setRevokeReason("");
      const data = await readPage(page, operation.signal);
      if (operation.current()) acceptPage(data);
    } catch (err) {
      if (operation.current()) {
        setRevokeError(toErrorMessage(err));
        setError(toErrorMessage(err));
      }
    } finally {
      operation.finish();
    }
  }

  async function restore(row: AdminCertificateRow) {
    await confirmMutation(
      `/api/admin/certificates/${encodeURIComponent(row.id)}/restore`,
      "POST",
      page
    );
  }
  async function remove(row: AdminCertificateRow) {
    await confirmMutation(
      `/api/admin/certificates/${encodeURIComponent(row.id)}`,
      "DELETE",
      items.length === 1 && page > 1 ? page - 1 : page
    );
  }
  async function confirmMutation(url: string, method: "POST" | "DELETE", targetPage: number) {
    const operation = begin();
    if (!operation) return;
    setError(null);
    let mutationAccepted = false;
    try {
      await requestEnvelope(url, { method, signal: operation.signal });
      mutationAccepted = true;
      if (!operation.current()) return;
      const data = await readPage(targetPage, operation.signal);
      if (operation.current()) acceptPage(data);
    } catch (err) {
      if (operation.current()) {
        setError(toErrorMessage(err));
        // Close an accepted confirmation; its refresh can be retried separately.
        if (!mutationAccepted) throw err;
      }
    } finally {
      operation.finish();
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        icon={<IconCertificate className="size-4" />}
        title="证书管理"
        description="签发、修改、吊销和删除用户培训完成证书。输入用户 ID 并上传证书图片即可签发。"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
              <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
              刷新
            </Button>
            <Button size="sm" disabled={loading} onClick={openCreate}>
              <IconPlus className="size-3.5" />
              签发证书
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="当前筛选" value={total} helper="符合条件的证书总数" />
        <Metric label="本页生效" value={pageActive} tone="default" />
        <Metric
          label="本页已吊销"
          value={pageRevoked}
          tone={pageRevoked > 0 ? "warn" : "default"}
        />
        <Metric label="页码" value={`${page} / ${totalPages}`} />
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-[11px] text-slate-500">用户 ID</Label>
          <Input
            value={userIdFilter}
            onChange={(event) => setUserIdFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void refresh(1);
            }}
            placeholder="精确匹配用户 ID"
            className="h-8 w-48"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-slate-500">证书编号</Label>
          <Input
            value={certNoFilter}
            onChange={(event) => setCertNoFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void refresh(1);
            }}
            placeholder="FD-..."
            className="h-8 w-48"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-slate-500">状态</Label>
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as AdminCertificateStatusFilter)}
          >
            <SelectTrigger className="h-8 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="active">生效中</SelectItem>
              <SelectItem value="revoked">已吊销</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh(1)} disabled={loading}>
          <IconSearch className="size-3.5" />
          查询
        </Button>
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[940px] border-separate border-spacing-0 text-left">
          <thead>
            <tr>
              <Th>证书</Th>
              <Th>用户 ID</Th>
              <Th>颁发方</Th>
              <Th>签发时间</Th>
              <Th>状态</Th>
              <Th className="text-right">操作</Th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-sm text-slate-500">
                  {loading ? "加载中…" : "暂无证书记录。"}
                </td>
              </tr>
            ) : (
              items.map((row) => {
                const revoked = Boolean(row.revokedAt);
                return (
                  <tr key={row.id} className="group hover:bg-slate-50/60">
                    <Td>
                      <div className="flex items-center gap-3">
                        <CertThumb url={adminMediaContentUrl(row.imageAssetId) ?? row.imageUrl} />
                        <div className="min-w-0">
                          <p className="max-w-[280px] truncate text-sm font-medium text-slate-950">
                            {row.title}
                          </p>
                          <button
                            type="button"
                            onClick={() => void copyText(row.certNo)}
                            className="mt-0.5 inline-flex items-center gap-1 font-mono text-[12px] text-slate-500 hover:text-slate-900"
                            title="复制证书编号"
                          >
                            {row.certNo}
                            <IconCopy className="size-3" />
                          </button>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <span className="font-mono text-[12px] text-slate-700">{row.userId}</span>
                    </Td>
                    <Td>
                      <span className="text-sm text-slate-700">{row.issuer}</span>
                    </Td>
                    <Td>
                      <span className="text-[12px] text-slate-600">{formatDate(row.issuedAt)}</span>
                    </Td>
                    <Td>
                      {revoked ? (
                        <div className="space-y-0.5">
                          <StatusPill tone="risk">已吊销</StatusPill>
                          {row.revokedReason ? (
                            <p className="max-w-[180px] truncate text-[11px] text-slate-400">
                              {row.revokedReason}
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <StatusPill tone="success">生效中</StatusPill>
                      )}
                    </Td>
                    <Td className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={loading}
                          onClick={() => openEdit(row)}
                        >
                          <IconEdit className="size-3.5" />
                          编辑
                        </Button>
                        {revoked ? (
                          <ConfirmDialog
                            title="恢复证书？"
                            description={`确认恢复「${row.title}」？恢复后该证书将重新对外有效。`}
                            confirmLabel="恢复"
                            onConfirm={() => restore(row)}
                            trigger={
                              <Button variant="outline" size="sm" disabled={loading}>
                                <IconRotateClockwise className="size-3.5" />
                                恢复
                              </Button>
                            }
                          />
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={loading}
                            onClick={() => {
                              if (loading) return;
                              setRevokeTarget(row);
                              setRevokeReason(row.revokedReason ?? "");
                              setRevokeError(null);
                            }}
                          >
                            <IconX className="size-3.5" />
                            吊销
                          </Button>
                        )}
                        <ConfirmDialog
                          title="删除证书？"
                          description={`确认永久删除「${row.title}」（${row.certNo}）？此操作不可恢复，验证链接将失效。如只是想停用，请改用「吊销」。`}
                          confirmLabel="永久删除"
                          destructive
                          onConfirm={() => remove(row)}
                          trigger={
                            <Button variant="destructive" size="sm" disabled={loading}>
                              <IconTrash className="size-3.5" />
                              删除
                            </Button>
                          }
                        />
                      </div>
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-[12px] text-slate-500">
        <span>共 {total} 条</span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={loading || page <= 1}
            onClick={() => void refresh(page - 1)}
          >
            上一页
          </Button>
          <span>
            第 {page} / {totalPages} 页
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={loading || page >= totalPages}
            onClick={() => void refresh(page + 1)}
          >
            下一页
          </Button>
        </div>
      </div>

      {/* Create / edit drawer */}
      <Sheet open={sheetOpen} onOpenChange={(next) => (saving ? null : setSheetOpen(next))}>
        <SheetContent
          side="right"
          className="flex w-[min(560px,calc(100vw-24px))] flex-col gap-0 p-0"
        >
          <SheetHeader className="border-b border-slate-200 px-4 py-3">
            <SheetTitle>{mode === "create" ? "签发证书" : "编辑证书"}</SheetTitle>
          </SheetHeader>

          <div inert={loading} className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
            <FormField
              label="用户 ID"
              hint="证书所属用户的 ID（来自 Java 用户系统）。签发后不可修改。"
            >
              {(id) => (
                <Input
                  id={id}
                  value={draft.userId}
                  disabled={mode === "edit"}
                  onChange={(event) => setDraft((d) => ({ ...d, userId: event.target.value }))}
                  placeholder="例如 2273"
                />
              )}
            </FormField>

            <FormField label="证书标题" hint="展示在证书与验证页上的标题。">
              {(id) => (
                <Input
                  id={id}
                  value={draft.title}
                  onChange={(event) => setDraft((d) => ({ ...d, title: event.target.value }))}
                  placeholder="例如 AIGC 内容创作认证"
                />
              )}
            </FormField>

            <FormField
              label="Credential qualification"
              hint="Select Certified AI Producer only after reviewing the submitted qualification. Training certificates alone do not grant Crew creation access."
            >
              {(id) => (
                <select
                  id={id}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={draft.credentialType}
                  onChange={(event) =>
                    setDraft((d) => ({ ...d, credentialType: event.target.value }))
                  }
                >
                  <option value="general">General / training certificate</option>
                  <option value="fizzdragon_certified_ai_producer">
                    FizzDragon Certified AI Producer
                  </option>
                </select>
              )}
            </FormField>

            <FormField label="颁发方">
              {(id) => (
                <Input
                  id={id}
                  value={draft.issuer}
                  onChange={(event) => setDraft((d) => ({ ...d, issuer: event.target.value }))}
                  placeholder="FizzDragon"
                />
              )}
            </FormField>

            {mode === "create" ? (
              <FormField
                label="证书编号（可选）"
                hint="留空自动生成；如填写需符合 FD-代码-年月-6位 格式，例如 FD-OPC-2606-AB12CD。"
              >
                {(id) => (
                  <>
                    <Input
                      id={id}
                      value={draft.certNo}
                      onChange={(event) =>
                        setDraft((d) => ({ ...d, certNo: event.target.value.toUpperCase() }))
                      }
                      placeholder="FD-OPC-2606-XXXXXX"
                    />
                    <p className="mt-1 text-[11px] text-slate-400">
                      {draft.certNo.trim() ? (
                        <>
                          将使用：
                          <span className="font-mono text-slate-500">
                            {draft.certNo.trim().toUpperCase()}
                          </span>
                        </>
                      ) : (
                        <>
                          留空将自动生成：
                          <span className="font-mono text-slate-500">
                            {autoCertNoPreview(draft.issuedAt)}
                          </span>
                        </>
                      )}
                    </p>
                  </>
                )}
              </FormField>
            ) : null}

            <FormField label="签发时间" hint="留空则使用当前时间。">
              {(id) => (
                <Input
                  id={id}
                  type="datetime-local"
                  value={draft.issuedAt}
                  onChange={(event) => setDraft((d) => ({ ...d, issuedAt: event.target.value }))}
                />
              )}
            </FormField>

            <div className="space-y-1.5">
              <Label className="text-[13px] font-medium text-slate-700">证书图片</Label>
              <CertificateImageField
                key={`${mode}:${editingId ?? "new"}`}
                begin={begin}
                busy={loading}
                value={{ assetId: draft.imageAssetId, url: draft.imageUrl }}
                onChange={(next) =>
                  setDraft((d) => ({ ...d, imageAssetId: next.assetId, imageUrl: next.url }))
                }
              />
            </div>

            {formError ? <ErrorBanner message={formError} /> : null}
          </div>

          <SheetFooter className="border-t border-slate-200 px-4 py-3">
            <Button variant="outline" onClick={() => setSheetOpen(false)} disabled={saving}>
              取消
            </Button>
            <Button onClick={() => void saveDraft()} disabled={saving}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Revoke dialog (with reason) */}
      <Dialog
        open={revokeTarget !== null}
        onOpenChange={(next) => {
          if (revoking) return;
          if (!next) {
            setRevokeTarget(null);
            setRevokeError(null);
          }
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>吊销证书？</DialogTitle>
            <DialogDescription>
              {revokeTarget
                ? `「${revokeTarget.title}」（${revokeTarget.certNo}）吊销后将不再对外有效，但记录保留，可随时恢复。`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-[13px] text-slate-700">吊销原因（可选）</Label>
            <Textarea
              disabled={revoking}
              value={revokeReason}
              onChange={(event) => setRevokeReason(event.target.value)}
              placeholder="例如：违规内容 / 误发"
              rows={3}
              maxLength={255}
            />
          </div>
          {revokeError ? <ErrorBanner message={revokeError} /> : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={revoking}>
                取消
              </Button>
            </DialogClose>
            <Button variant="destructive" onClick={() => void confirmRevoke()} disabled={revoking}>
              {revoking ? "吊销中…" : "确认吊销"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CertificateImageField({
  value,
  onChange,
  begin,
  busy,
}: {
  value: { assetId: string; url: string };
  onChange: (next: { assetId: string; url: string }) => void;
  begin: ReturnType<typeof useAdminOperation>["begin"];
  busy: boolean;
}) {
  const inputId = useId();
  const uploading = busy;
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const pending = useRef<ReturnType<typeof begin>>(null);
  const previewRef = useRef<string | null>(null);
  useEffect(
    () => () => {
      pending.current?.cancel();
      pending.current?.finish();
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      previewRef.current = null;
    },
    []
  );

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    const operation = begin();
    if (!operation) return;
    pending.current = operation;
    setUploadError(null);
    let preview: string | null = null;
    try {
      preview = URL.createObjectURL(file);
      previewRef.current = preview;
      setLocalPreview(preview);
      const form = new FormData();
      form.append("file", file);
      const data = await requestEnvelope<{ asset: { id: string; url: string | null } | null }>(
        "/api/admin/certificates/media",
        { method: "POST", body: form, signal: operation.signal }
      );
      if (!operation.current()) return;
      if (!data.asset) throw new Error("上传失败");
      onChange({
        assetId: data.asset.id,
        url: adminMediaContentUrl(data.asset.id) ?? data.asset.url ?? "",
      });
    } catch (err) {
      if (operation.current()) setUploadError(toErrorMessage(err));
    } finally {
      if (preview && previewRef.current === preview) {
        URL.revokeObjectURL(preview);
        previewRef.current = null;
        if (operation.current()) setLocalPreview(null);
      }
      operation.finish();
    }
  }

  const shown = localPreview ?? (value.url || null);

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown} alt="证书预览" className="size-full object-cover" />
          ) : (
            <IconPhoto className="size-6 text-slate-300" />
          )}
        </div>
        <div className="space-y-1.5">
          <Label
            htmlFor={inputId}
            className={cn(
              "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-[13px] font-medium text-slate-700 hover:bg-slate-50",
              uploading && "pointer-events-none opacity-60"
            )}
          >
            <IconUpload className="size-3.5" />
            {uploading ? "上传中…" : value.assetId ? "替换图片" : "上传图片"}
          </Label>
          <input
            id={inputId}
            type="file"
            disabled={busy}
            accept="image/*"
            className="hidden"
            onChange={(event) => void handleFile(event)}
          />
          <p className="text-[11px] text-slate-400">PNG/JPG，最大 20MB。</p>
        </div>
      </div>
      {uploadError ? <p className="text-[12px] text-red-600">{uploadError}</p> : null}
    </div>
  );
}

function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-[13px] font-medium text-slate-700">
        {label}
      </Label>
      {children(id)}
      {hint ? <p className="text-[11px] text-slate-400">{hint}</p> : null}
    </div>
  );
}

function CertThumb({ url }: { url: string | null }) {
  if (!url) {
    return (
      <div className="grid size-10 shrink-0 place-items-center rounded-lg border border-slate-200 bg-slate-50">
        <IconCertificate className="size-4 text-slate-400" />
      </div>
    );
  }
  return (
    <div className="size-10 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className="size-full object-cover" />
    </div>
  );
}

function adminMediaContentUrl(assetId: string | null | undefined) {
  if (!assetId) return null;
  return `/api/admin/media/assets/${encodeURIComponent(assetId)}/content?variantKey=original`;
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-medium text-slate-500",
        className
      )}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={cn("border-b border-slate-100 px-3 py-2.5 align-middle", className)}>
      {children}
    </td>
  );
}

function isoToLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function localInputToIso(local: string): string {
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

// Illustrative preview of the auto-generated cert number when 证书编号 is left
// blank (server uses FD-GEN-{YYMM}-{RANDOM}). The random suffix is bullets
// since it's allocated server-side; YYMM uses UTC to match the server.
function autoCertNoPreview(issuedAtLocal: string): string {
  const parsed = issuedAtLocal ? new Date(issuedAtLocal) : new Date();
  const when = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const yy = String(when.getUTCFullYear() % 100).padStart(2, "0");
  const mm = String(when.getUTCMonth() + 1).padStart(2, "0");
  return `FD-GEN-${yy}${mm}-••••••`;
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // Clipboard may be unavailable (insecure context) — ignore.
  }
}
