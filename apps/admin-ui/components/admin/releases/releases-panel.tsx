"use client";

// 应用发布 — mobile app version manifest. Drives the in-app update check:
// the newest `active` row per platform is what clients on that platform are
// offered. Create a row per store/APK release; set 强制更新版本号 to force
// builds older than it; toggle 停用 to pull a bad announcement.

import { useMemo, useRef, useState } from "react";
import { IconDeviceMobile, IconEdit, IconPlus, IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AdminDialog,
  ErrorBanner,
  FormLabel,
  PageHeader,
  Select,
  StatusPill,
  TextInput,
  mutateEnvelope,
  requestEnvelope,
  stringField,
  toErrorMessage,
} from "../billing/shared";
import {
  PLATFORM_LABELS,
  type AppPlatform,
  type AppReleaseRow,
  type AppReleasesData,
} from "./releases-types";

import { useAdminOperation } from "../use-admin-operation";

type DialogState = { mode: "create" } | { mode: "edit"; row: AppReleaseRow } | null;

export function ReleasesPanel({
  siteLabel,
  databaseLabel,
  initialData,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialData: AppReleasesData | null;
  initialError: string | null;
}) {
  const [rows, setRows] = useState<AppReleaseRow[]>(initialData?.items ?? []);
  const [error, setError] = useState<string | null>(initialError);
  const [dialog, setDialog] = useState<DialogState>(null);
  const { busy, begin } = useAdminOperation();
  const writing = useRef(false);
  const activeDialog = useRef<DialogState>(null);
  const openDialog = (next: DialogState) => {
    if (writing.current) return;
    activeDialog.current = next;
    setDialog(next);
    setError(null);
  };

  const load = async (operation: NonNullable<ReturnType<typeof begin>>) => {
    const data = await requestEnvelope<AppReleasesData>(
      "/api/admin/app-releases",
      operation.signal
    );
    if (operation.current()) setRows(data.items);
  };
  const refresh = async () => {
    const operation = begin("read");
    if (!operation) return;
    setError(null);
    try {
      await load(operation);
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  };

  // The row clients actually see per platform (newest active by versionCode).
  const liveIds = useMemo(() => {
    const live = new Map<AppPlatform, AppReleaseRow>();
    for (const row of rows) {
      if (!row.active) continue;
      const cur = live.get(row.platform);
      if (!cur || row.versionCode > cur.versionCode) live.set(row.platform, row);
    }
    return new Set([...live.values()].map((r) => r.id));
  }, [rows]);

  const submit = async (form: FormData) => {
    if (!dialog || activeDialog.current !== dialog) return;
    const operation = begin("write");
    if (!operation) return;
    writing.current = true;
    setError(null);
    try {
      const notes = stringField(form, "releaseNotes").trim();
      const minCode = stringField(form, "minSupportedCode").trim();
      const payload: Record<string, unknown> = {
        versionName: stringField(form, "versionName").trim(),
        versionCode: parseVersionCode(stringField(form, "versionCode")),
        downloadUrl: stringField(form, "downloadUrl").trim(),
        releaseNotes: notes || null,
        minSupportedCode: minCode ? parseVersionCode(minCode) : null,
      };
      if (
        payload.minSupportedCode !== null &&
        (payload.minSupportedCode as number) > (payload.versionCode as number)
      )
        throw new Error("Minimum supported version cannot exceed the release version.");
      if (dialog?.mode === "create") {
        payload.platform = stringField(form, "platform");
        payload.active = true;
        await mutateEnvelope("/api/admin/app-releases", payload, "POST", operation.signal);
      } else if (dialog?.mode === "edit") {
        await mutateEnvelope(
          `/api/admin/app-releases/${dialog.row.id}`,
          payload,
          "PATCH",
          operation.signal
        );
      }
      if (!operation.current()) return;
      activeDialog.current = null;
      setDialog(null);
      await load(operation);
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      if (operation.current()) writing.current = false;
      operation.finish();
    }
  };

  const toggleActive = async (row: AppReleaseRow) => {
    const operation = begin("write");
    if (!operation) return;
    writing.current = true;
    setError(null);
    try {
      await mutateEnvelope(
        `/api/admin/app-releases/${row.id}`,
        { active: !row.active },
        "PATCH",
        operation.signal
      );
      if (!operation.current()) return;
      setRows((previous) =>
        previous.map((item) => (item.id === row.id ? { ...item, active: !row.active } : item))
      );
      await load(operation);
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      if (operation.current()) writing.current = false;
      operation.finish();
    }
  };

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        title="应用发布"
        icon={<IconDeviceMobile className="size-5" />}
        description="移动端版本清单，驱动 App 内的「检查更新」。每个平台以版本号最大的启用行为准。"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={busy}>
              <IconRefresh className="size-3.5" />
              刷新
            </Button>
            <Button size="sm" onClick={() => openDialog({ mode: "create" })} disabled={busy}>
              <IconPlus className="size-3.5" />
              新建发布
            </Button>
          </div>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}

      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[12px] font-semibold text-slate-500">
            <tr>
              <th className="px-4 py-2.5 text-left">平台</th>
              <th className="px-4 py-2.5 text-left">版本</th>
              <th className="px-4 py-2.5 text-left">版本号</th>
              <th className="px-4 py-2.5 text-left">强制更新</th>
              <th className="px-4 py-2.5 text-left">状态</th>
              <th className="px-4 py-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  暂无发布记录。点击「新建发布」添加第一条。
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="text-slate-700">
                  <td className="px-4 py-3">{PLATFORM_LABELS[row.platform]}</td>
                  <td className="px-4 py-3 font-medium text-slate-950">{row.versionName}</td>
                  <td className="px-4 py-3 tabular-nums">{row.versionCode}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-500">
                    {row.minSupportedCode ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    {liveIds.has(row.id) ? (
                      <StatusPill tone="success">线上生效</StatusPill>
                    ) : row.active ? (
                      <StatusPill tone="muted">启用</StatusPill>
                    ) : (
                      <StatusPill tone="risk">停用</StatusPill>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => openDialog({ mode: "edit", row })}
                        disabled={busy}
                      >
                        <IconEdit className="size-3" />
                        编辑
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => void toggleActive(row)}
                        disabled={busy}
                      >
                        {row.active ? "停用" : "启用"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {dialog ? (
        <ReleaseDialog
          key={dialog.mode === "edit" ? dialog.row.id : "create"}
          state={dialog}
          busy={busy}
          onClose={() => openDialog(null)}
          onSubmit={submit}
        />
      ) : null}
    </div>
  );
}

function ReleaseDialog({
  state,
  busy,
  onClose,
  onSubmit,
}: {
  state: Exclude<DialogState, null>;
  busy: boolean;
  onClose: () => void;
  onSubmit: (form: FormData) => void;
}) {
  const row = state.mode === "edit" ? state.row : null;
  return (
    <AdminDialog
      open
      title={state.mode === "create" ? "新建发布" : `编辑发布 · ${row?.versionName}`}
      description="下载地址：CN Android 填直下 APK 链接，iOS/Google Play 填商店页链接。"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button size="sm" type="submit" form="release-form" disabled={busy}>
            {busy ? "保存中…" : "保存"}
          </Button>
        </>
      }
    >
      <form
        inert={busy}
        id="release-form"
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(new FormData(event.currentTarget));
        }}
      >
        {state.mode === "create" ? (
          <FormLabel label="平台">
            <Select name="platform" defaultValue="android">
              <option value="android">Android</option>
              <option value="ios">iOS</option>
            </Select>
          </FormLabel>
        ) : (
          <input type="hidden" name="platform" value={row?.platform} />
        )}
        <div className="grid grid-cols-2 gap-4">
          <FormLabel label="版本名 (versionName)" help="展示给用户，如 2.0.2">
            <TextInput name="versionName" defaultValue={row?.versionName} required />
          </FormLabel>
          <FormLabel label="版本号 (versionCode)" help="整数，比较用；必须严格递增">
            <TextInput
              name="versionCode"
              type="number"
              min={1}
              defaultValue={row?.versionCode}
              required
            />
          </FormLabel>
        </div>
        <FormLabel label="下载地址 (downloadUrl)">
          <TextInput
            name="downloadUrl"
            type="url"
            placeholder="https://…/FizzDragon-2.0.2-70.apk"
            defaultValue={row?.downloadUrl}
            required
          />
        </FormLabel>
        <FormLabel
          label="强制更新版本号 (minSupportedCode)"
          help="留空为可选更新；填写后低于该版本号的旧包会收到无法关闭的强制更新弹窗"
        >
          <TextInput
            name="minSupportedCode"
            type="number"
            min={1}
            defaultValue={row?.minSupportedCode ?? undefined}
          />
        </FormLabel>
        <FormLabel label="更新说明 (releaseNotes)" help="弹窗正文，可留空">
          <Textarea name="releaseNotes" rows={4} defaultValue={row?.releaseNotes ?? ""} />
        </FormLabel>
      </form>
    </AdminDialog>
  );
}

function parseVersionCode(raw: string) {
  const value = raw.trim();
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1 || number > 2147483647)
    throw new Error("Version codes must be whole numbers between 1 and 2147483647.");
  return number;
}
