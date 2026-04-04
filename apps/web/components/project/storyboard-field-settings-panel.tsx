"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconAlignLeft,
  IconChecks,
  IconChevronDown,
  IconChevronUp,
  IconClock,
  IconEye,
  IconEyeOff,
  IconGripVertical,
  IconMapPin,
  IconMessageCircle,
  IconPhoto,
  IconPlus,
  IconQuestionMark,
  IconSettings,
  IconTrash,
  IconVideo,
} from "@tabler/icons-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { backendApi } from "@/src/lib/api";
import { useTranslations } from "next-intl";
import { useAppSelector, useAppDispatch } from "@/src/store";
import {
  setColumns,
  selectCurrentInstance,
  type ShotColumn,
} from "@/src/store/slices/projectSlice";

type EditableFieldState = {
  name: string;
  aiRef: string[];
  options: Array<{ name: string }>;
};

type CreateFieldState = {
  name: string;
  type: "TEXT" | "IMAGE" | "VIDEO" | "SINGLE_OPTION";
  aiRef: string[];
  options: Array<{ name: string }>;
};

const emptyEditableField: EditableFieldState = {
  name: "",
  aiRef: [],
  options: [],
};

const emptyCreateField: CreateFieldState = {
  name: "",
  type: "TEXT",
  aiRef: [],
  options: [],
};

function getFieldIcon(columnType?: string) {
  const type = String(columnType ?? "").toUpperCase();

  switch (type) {
    case "IMAGE":
      return IconPhoto;
    case "VIDEO":
      return IconVideo;
    case "SINGLE_OPTION":
    case "SELECT":
      return IconChecks;
    case "NUMBER":
    case "DURATION":
      return IconClock;
    case "SCENE":
      return IconMapPin;
    case "CHARACTER":
    case "DIALOGUE":
      return IconMessageCircle;
    default:
      return IconAlignLeft;
  }
}

function getFieldTypeLabel(columnType?: string) {
  const type = String(columnType ?? "").toUpperCase();

  switch (type) {
    case "IMAGE":
      return "Image";
    case "VIDEO":
      return "Video";
    case "SINGLE_OPTION":
    case "SELECT":
      return "Option";
    case "NUMBER":
      return "Number";
    case "SCENE":
      return "Scene";
    case "CHARACTER":
      return "Character";
    default:
      return "Text";
  }
}

function normalizeOptions(columnOptions: unknown): Array<{ name: string }> {
  if (!Array.isArray(columnOptions)) return [];

  return columnOptions
    .map((option) => {
      if (typeof option === "string") return { name: option };
      if (option && typeof option === "object" && "name" in option) {
        const name = option.name;
        return typeof name === "string" ? { name } : null;
      }
      return null;
    })
    .filter((option): option is { name: string } => Boolean(option?.name?.trim()));
}

function normalizeAiRef(aiRef: unknown): string[] {
  if (!Array.isArray(aiRef)) return [];
  return aiRef.map((item) => String(item)).filter(Boolean);
}

function stripResolvedType(column: ShotColumn) {
  const rest = { ...column };
  delete rest.resolvedType;
  return rest;
}

function reorderFields(fields: ShotColumn[], fromId: string, toId: string): ShotColumn[] {
  if (fromId === toId) return fields;

  const fromIndex = fields.findIndex((field) => String(field.id) === fromId);
  const toIndex = fields.findIndex((field) => String(field.id) === toId);
  if (fromIndex < 0 || toIndex < 0) return fields;

  const next = [...fields];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next.map((field, index) => ({ ...field, sort: index }));
}

export function StoryboardFieldSettingsPanel({
  storyBoardId,
  disabled,
}: {
  storyBoardId?: string | null;
  disabled?: boolean;
}) {
  const t = useTranslations("storyboard");
  const tc = useTranslations("common");
  const columns = useAppSelector((s) => selectCurrentInstance(s).columns);

  const [open, setOpen] = useState(false);
  const [localColumns, setLocalColumns] = useState<ShotColumn[]>([]);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<EditableFieldState>(emptyEditableField);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showCreateField, setShowCreateField] = useState(false);
  const [createField, setCreateField] = useState<CreateFieldState>(emptyCreateField);
  const [draggingFieldId, setDraggingFieldId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShotColumn | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocalColumns([...columns].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)));
  }, [columns]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setEditingFieldId(null);
        setShowCreateField(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const availableCreateReferenceColumns = useMemo(
    () =>
      localColumns.filter(
        (column) =>
          !["IMAGE", "VIDEO"].includes(String(column.columnType ?? "").toUpperCase()) &&
          !createField.aiRef.includes(String(column.id ?? ""))
      ),
    [createField.aiRef, localColumns]
  );

  const availableEditReferenceColumns = useMemo(
    () =>
      localColumns.filter(
        (column) =>
          !["IMAGE", "VIDEO"].includes(String(column.columnType ?? "").toUpperCase()) &&
          String(column.id ?? "") !== editingFieldId &&
          !editingField.aiRef.includes(String(column.id ?? ""))
      ),
    [editingField.aiRef, editingFieldId, localColumns]
  );

  const persistColumnsList = async (nextColumns: ShotColumn[]) => {
    if (!storyBoardId) return;
    const payload = nextColumns.map((column, index) => ({
      ...stripResolvedType(column),
      sort: index,
    }));
    await backendApi.post(`/api/user/shotColumn/updateList/${storyBoardId}`, {
      data: { columns: payload },
    });
  };

  const reloadColumns = async () => {
    if (!storyBoardId) return;
    const data = await backendApi.post<ShotColumn[]>("/api/user/shotColumn/list", {
      data: { storyBoardId },
    });
    setColumns(Array.isArray(data) ? data : []);
  };

  const handleToggleVisibility = async (fieldId: string) => {
    const nextColumns = localColumns.map((field) =>
      String(field.id) === fieldId ? { ...field, hide: !field.hide } : field
    );
    setLocalColumns(nextColumns);
    setColumns(nextColumns);

    try {
      await persistColumnsList(nextColumns);
    } catch (error) {
      console.error("[StoryboardFieldSettings] 更新字段可见性失败:", error);
      toast.error("更新字段可见性失败");
      void reloadColumns();
    }
  };

  const handleStartEdit = (field: ShotColumn) => {
    setEditingFieldId(String(field.id ?? ""));
    setEditingField({
      name: String(field.columnName ?? ""),
      aiRef: normalizeAiRef(field.aiRef),
      options: normalizeOptions(field.columnOptions),
    });
    setShowCreateField(false);
  };

  const resetEdit = () => {
    setEditingFieldId(null);
    setEditingField(emptyEditableField);
  };

  const handleSaveEdit = async () => {
    if (!editingFieldId) return;
    if (!editingField.name.trim()) {
      toast.warning("请输入字段名称");
      return;
    }

    const target = localColumns.find((field) => String(field.id) === editingFieldId);
    if (!target) return;

    setSaving(true);
    try {
      const validOptions = editingField.options.filter((option) => option.name.trim());
      const payload = {
        ...stripResolvedType(target),
        id: String(target.id ?? ""),
        columnName: editingField.name.trim(),
        aiRef:
          ["IMAGE", "VIDEO"].includes(String(target.columnType ?? "").toUpperCase()) &&
          editingField.aiRef.length > 0
            ? editingField.aiRef
            : undefined,
        columnOptions: ["SINGLE_OPTION", "SELECT"].includes(
          String(target.columnType ?? "").toUpperCase()
        )
          ? validOptions
          : undefined,
      };

      await backendApi.post(`/api/user/shotColumn/update/${payload.id}`, { data: payload });
      const nextColumns = localColumns.map((field) =>
        String(field.id) === editingFieldId
          ? {
              ...field,
              columnName: editingField.name.trim(),
              aiRef: payload.aiRef,
              columnOptions: payload.columnOptions,
            }
          : field
      );
      setLocalColumns(nextColumns);
      setColumns(nextColumns);
      toast.success("字段更新成功");
      resetEdit();
    } catch (error) {
      console.error("[StoryboardFieldSettings] 更新字段失败:", error);
      toast.error("字段更新失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteField = async (field: ShotColumn) => {
    if (!field.id) return;
    try {
      await backendApi.post(`/api/user/shotColumn/delete/${String(field.id)}`);
      await reloadColumns();
      toast.success(t("fieldDeleted"));
      resetEdit();
    } catch (error) {
      console.error("[StoryboardFieldSettings] delete failed:", error);
      toast.error(t("fieldDeleteFailed"));
    }
  };

  const handleCreateField = async () => {
    if (!storyBoardId) return;
    if (!createField.name.trim()) {
      toast.warning("请输入字段名称");
      return;
    }

    const validOptions = createField.options.filter((option) => option.name.trim());
    if (createField.type === "SINGLE_OPTION" && validOptions.length === 0) {
      toast.warning("请至少添加一个选项");
      return;
    }

    setCreating(true);
    try {
      await backendApi.post<ShotColumn>("/api/user/shotColumn/create", {
        data: {
          storyBoardId,
          columnName: createField.name.trim(),
          columnType: createField.type,
          columnOptions: createField.type === "SINGLE_OPTION" ? validOptions : [],
          aiRef:
            ["IMAGE", "VIDEO"].includes(createField.type) && createField.aiRef.length > 0
              ? createField.aiRef
              : undefined,
        },
      });
      await reloadColumns();
      toast.success("字段创建成功");
      setShowCreateField(false);
      setCreateField(emptyCreateField);
    } catch (error) {
      console.error("[StoryboardFieldSettings] 创建字段失败:", error);
      toast.error("字段创建失败");
    } finally {
      setCreating(false);
    }
  };

  const handleDropField = async (targetId: string) => {
    if (!draggingFieldId || !storyBoardId) return;
    const nextColumns = reorderFields(localColumns, draggingFieldId, targetId);
    setDraggingFieldId(null);
    setLocalColumns(nextColumns);
    setColumns(nextColumns);

    try {
      await persistColumnsList(nextColumns);
      toast.success("字段顺序已更新");
    } catch (error) {
      console.error("[StoryboardFieldSettings] 更新字段顺序失败:", error);
      toast.error("字段顺序更新失败");
      void reloadColumns();
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="outline"
        color="muted"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="border-border/80 bg-white/5 text-muted-foreground hover:text-foreground"
      >
        <IconSettings className="size-4" />
        {t("fieldSettings")}
      </Button>

      {open ? (
        <div className="absolute right-0 top-12 z-30 w-[420px] rounded-2xl border border-border bg-[#2A2A2E] shadow-2xl">
          <div className="border-b border-border/70 px-4 py-3">
            <div className="text-sm font-semibold text-white">{t("fieldSettings")}</div>
          </div>

          <div className="max-h-[560px] space-y-2 overflow-y-auto p-3">
            {localColumns.map((field) => {
              const fieldId = String(field.id ?? "");
              const isEditing = editingFieldId === fieldId;
              const Icon = getFieldIcon(String(field.columnType ?? field.resolvedType ?? ""));

              return (
                <div
                  key={
                    fieldId || String(field.presetColumnKey ?? field.columnName ?? Math.random())
                  }
                  draggable={!isEditing}
                  onDragStart={() => {
                    if (!isEditing) setDraggingFieldId(fieldId);
                  }}
                  onDragOver={(event) => {
                    if (!isEditing && draggingFieldId) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (!isEditing) void handleDropField(fieldId);
                  }}
                  className={cn(
                    "rounded-xl border border-transparent bg-[#1A1A1A] p-4 transition-colors",
                    field.hide && "opacity-55",
                    isEditing && "border-primary bg-[#242427]"
                  )}
                >
                  {isEditing ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between border-b border-border/70 pb-3">
                        <div className="flex items-center gap-3">
                          <Icon className="size-4 text-muted-foreground" />
                          <div className="text-sm font-medium text-white">
                            {field.columnName ?? "未命名字段"}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="text-muted-foreground transition-colors hover:text-foreground"
                          onClick={resetEdit}
                        >
                          <IconChevronUp className="size-4" />
                        </button>
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">字段名称</div>
                        <Input
                          value={editingField.name}
                          onChange={(event) =>
                            setEditingField((current) => ({ ...current, name: event.target.value }))
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">字段类型</div>
                        <div className="flex h-9 items-center gap-2 rounded-lg bg-white/5 px-3 text-sm text-white">
                          <Icon className="size-4 text-muted-foreground" />
                          {getFieldTypeLabel(String(field.columnType ?? field.resolvedType ?? ""))}
                        </div>
                      </div>

                      {["SINGLE_OPTION", "SELECT"].includes(
                        String(field.columnType ?? field.resolvedType ?? "").toUpperCase()
                      ) ? (
                        <div className="space-y-2">
                          <div className="text-xs text-muted-foreground">选项内容</div>
                          <div className="space-y-2">
                            {editingField.options.map((option, index) => (
                              <div key={`${fieldId}-option-${index}`} className="flex gap-2">
                                <Input
                                  value={option.name}
                                  onChange={(event) =>
                                    setEditingField((current) => ({
                                      ...current,
                                      options: current.options.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? { ...item, name: event.target.value }
                                          : item
                                      ),
                                    }))
                                  }
                                />
                                <Button
                                  variant="ghost"
                                  color="muted"
                                  size="icon-xs"
                                  onClick={() =>
                                    setEditingField((current) => ({
                                      ...current,
                                      options: current.options.filter(
                                        (_item, itemIndex) => itemIndex !== index
                                      ),
                                    }))
                                  }
                                >
                                  <IconTrash className="size-3.5" />
                                </Button>
                              </div>
                            ))}
                          </div>

                          <Button
                            variant="outline"
                            color="muted"
                            size="sm"
                            className="w-full justify-center border-dashed"
                            onClick={() =>
                              setEditingField((current) => ({
                                ...current,
                                options: [...current.options, { name: "" }],
                              }))
                            }
                          >
                            <IconPlus className="size-3.5" />
                            添加选项
                          </Button>
                        </div>
                      ) : null}

                      {["IMAGE", "VIDEO"].includes(
                        String(field.columnType ?? field.resolvedType ?? "").toUpperCase()
                      ) ? (
                        <div className="space-y-2">
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            镜头引用字段
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex cursor-help">
                                    <IconQuestionMark className="size-3.5" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  图片/视频生成时会按这些字段拼接默认提示词。
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>

                          <div className="space-y-2">
                            {editingField.aiRef.map((columnId) => {
                              const related = localColumns.find(
                                (column) => String(column.id ?? "") === columnId
                              );
                              const RelatedIcon = getFieldIcon(
                                String(related?.columnType ?? related?.resolvedType ?? "")
                              );

                              return (
                                <div
                                  key={`${fieldId}-ref-${columnId}`}
                                  className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2"
                                >
                                  <RelatedIcon className="size-4 text-muted-foreground" />
                                  <div className="flex-1 text-sm text-white">
                                    {related?.columnName ?? columnId}
                                  </div>
                                  <Button
                                    variant="ghost"
                                    color="muted"
                                    size="icon-xs"
                                    onClick={() =>
                                      setEditingField((current) => ({
                                        ...current,
                                        aiRef: current.aiRef.filter((item) => item !== columnId),
                                      }))
                                    }
                                  >
                                    <IconTrash className="size-3.5" />
                                  </Button>
                                </div>
                              );
                            })}
                          </div>

                          <NativeSelect
                            value=""
                            onChange={(event) => {
                              const value = event.target.value;
                              if (!value) return;
                              setEditingField((current) =>
                                current.aiRef.includes(value)
                                  ? current
                                  : { ...current, aiRef: [...current.aiRef, value] }
                              );
                            }}
                          >
                            <NativeSelectOption value="">添加引用字段</NativeSelectOption>
                            {availableEditReferenceColumns.map((column) => (
                              <NativeSelectOption
                                key={`edit-ref-${column.id}`}
                                value={String(column.id ?? "")}
                              >
                                {column.columnName ?? "未命名字段"}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        </div>
                      ) : null}

                      <div className="flex items-center justify-between border-t border-border/70 pt-3">
                        {!field.presetColumnKey ? (
                          <Button
                            variant="soft"
                            color="destructive"
                            onClick={() => setDeleteTarget(field)}
                          >
                            {tc("delete")}
                          </Button>
                        ) : (
                          <span />
                        )}

                        <div className="flex gap-2">
                          <Button variant="outline" color="muted" onClick={resetEdit}>
                            {tc("cancel")}
                          </Button>
                          <Button onClick={() => void handleSaveEdit()} disabled={saving}>
                            {saving ? tc("savingPlaceholder") : tc("confirm")}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <button
                        type="button"
                        className="flex flex-1 items-center gap-3 text-left"
                        onClick={() => handleStartEdit(field)}
                      >
                        <Icon className="size-4 text-muted-foreground" />
                        <span className="text-sm text-white">
                          {field.columnName ?? "未命名字段"}
                        </span>
                      </button>

                      <div className="flex items-center gap-1 text-muted-foreground">
                        <button type="button" className="cursor-move p-1">
                          <IconGripVertical className="size-4" />
                        </button>
                        <button
                          type="button"
                          className="p-1 transition-colors hover:text-foreground"
                          onClick={() => void handleToggleVisibility(fieldId)}
                        >
                          {field.hide ? (
                            <IconEyeOff className="size-4" />
                          ) : (
                            <IconEye className="size-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          className="p-1 transition-colors hover:text-foreground"
                          onClick={() => handleStartEdit(field)}
                        >
                          <IconChevronDown className="size-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {showCreateField ? (
              <div className="rounded-xl border border-border bg-[#1A1A1A] p-4">
                <div className="mb-4 text-sm font-medium text-white">新增字段</div>
                <div className="space-y-4">
                  <Input
                    value={createField.name}
                    onChange={(event) =>
                      setCreateField((current) => ({ ...current, name: event.target.value }))
                    }
                    placeholder="字段名称"
                  />

                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">字段类型</div>
                    <NativeSelect
                      value={createField.type}
                      onChange={(event) =>
                        setCreateField((current) => ({
                          ...current,
                          type: event.target.value as CreateFieldState["type"],
                          options: event.target.value === "SINGLE_OPTION" ? current.options : [],
                          aiRef: ["IMAGE", "VIDEO"].includes(event.target.value)
                            ? current.aiRef
                            : [],
                        }))
                      }
                    >
                      <NativeSelectOption value="TEXT">Text</NativeSelectOption>
                      <NativeSelectOption value="IMAGE">Image</NativeSelectOption>
                      <NativeSelectOption value="VIDEO">Video</NativeSelectOption>
                      <NativeSelectOption value="SINGLE_OPTION">Option</NativeSelectOption>
                    </NativeSelect>
                  </div>

                  {createField.type === "SINGLE_OPTION" ? (
                    <div className="space-y-2">
                      <div className="text-xs text-muted-foreground">选项内容</div>
                      {createField.options.map((option, index) => (
                        <div key={`create-option-${index}`} className="flex gap-2">
                          <Input
                            value={option.name}
                            onChange={(event) =>
                              setCreateField((current) => ({
                                ...current,
                                options: current.options.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, name: event.target.value } : item
                                ),
                              }))
                            }
                          />
                          <Button
                            variant="ghost"
                            color="muted"
                            size="icon-xs"
                            onClick={() =>
                              setCreateField((current) => ({
                                ...current,
                                options: current.options.filter(
                                  (_item, itemIndex) => itemIndex !== index
                                ),
                              }))
                            }
                          >
                            <IconTrash className="size-3.5" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        variant="outline"
                        color="muted"
                        size="sm"
                        className="w-full justify-center border-dashed"
                        onClick={() =>
                          setCreateField((current) => ({
                            ...current,
                            options: [...current.options, { name: "" }],
                          }))
                        }
                      >
                        <IconPlus className="size-3.5" />
                        添加选项
                      </Button>
                    </div>
                  ) : null}

                  {["IMAGE", "VIDEO"].includes(createField.type) ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        镜头引用字段
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex cursor-help">
                                <IconQuestionMark className="size-3.5" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              图片/视频生成时会按这些字段拼接默认提示词。
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>

                      <div className="space-y-2">
                        {createField.aiRef.map((columnId) => {
                          const related = localColumns.find(
                            (column) => String(column.id ?? "") === columnId
                          );
                          const RelatedIcon = getFieldIcon(
                            String(related?.columnType ?? related?.resolvedType ?? "")
                          );

                          return (
                            <div
                              key={`create-ref-${columnId}`}
                              className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2"
                            >
                              <RelatedIcon className="size-4 text-muted-foreground" />
                              <div className="flex-1 text-sm text-white">
                                {related?.columnName ?? columnId}
                              </div>
                              <Button
                                variant="ghost"
                                color="muted"
                                size="icon-xs"
                                onClick={() =>
                                  setCreateField((current) => ({
                                    ...current,
                                    aiRef: current.aiRef.filter((item) => item !== columnId),
                                  }))
                                }
                              >
                                <IconTrash className="size-3.5" />
                              </Button>
                            </div>
                          );
                        })}
                      </div>

                      <NativeSelect
                        value=""
                        onChange={(event) => {
                          const value = event.target.value;
                          if (!value) return;
                          setCreateField((current) =>
                            current.aiRef.includes(value)
                              ? current
                              : { ...current, aiRef: [...current.aiRef, value] }
                          );
                        }}
                      >
                        <NativeSelectOption value="">添加引用字段</NativeSelectOption>
                        {availableCreateReferenceColumns.map((column) => (
                          <NativeSelectOption
                            key={`create-ref-option-${column.id}`}
                            value={String(column.id ?? "")}
                          >
                            {column.columnName ?? "未命名字段"}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </div>
                  ) : null}

                  <div className="flex justify-end gap-2 border-t border-border/70 pt-3">
                    <Button
                      variant="outline"
                      color="muted"
                      onClick={() => {
                        setShowCreateField(false);
                        setCreateField(emptyCreateField);
                      }}
                    >
                      {tc("cancel")}
                    </Button>
                    <Button onClick={() => void handleCreateField()} disabled={creating}>
                      {creating ? "创建中..." : tc("confirm")}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setShowCreateField(true);
                  resetEdit();
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-transparent px-4 py-3 text-sm text-muted-foreground transition-colors hover:border-primary/60 hover:bg-primary/5 hover:text-primary"
              >
                <IconPlus className="size-4" />
                Add Field
              </button>
            )}
          </div>
        </div>
      ) : null}

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tc("confirm")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirmDeleteField", { name: deleteTarget?.columnName ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="solid"
              color="destructive"
              onClick={() => {
                if (deleteTarget) void handleDeleteField(deleteTarget);
                setDeleteTarget(null);
              }}
            >
              {tc("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
