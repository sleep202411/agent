"use client";

import { adminUiApiPath } from "@/lib/admin-api";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type ProjectType = "interactive_film" | "series";
type TaskCategory = "creative" | "production";

interface DeliveryField {
  type: string;
  required: boolean;
}

interface TaskQualification {
  pdLevel?: "PD" | "FD";
  certification?: string;
}

interface TaskPriceRange {
  min: number;
  max?: number;
  unit?: "percent";
}

interface TaskTemplateItem {
  templateKey: string;
  title: string;
  category: TaskCategory;
  roleRequirement: string;
  qualification?: TaskQualification;
  deliveryFields: DeliveryField[];
  unit: string;
  priceRange?: TaskPriceRange;
  defaultDependencies: string[];
  taskKind?: string;
  priority?: "normal" | "urgent" | "critical";
  requiresPlotTree?: boolean;
}

interface TaskTemplateDefinition {
  version: number;
  items: TaskTemplateItem[];
  plotTree?: unknown;
}

interface ProjectTaskTemplate {
  id: string;
  projectType: ProjectType;
  name: string;
  version: number;
  active: boolean;
  definition: TaskTemplateDefinition;
  createdAt: string;
  updatedAt: string;
}

interface PlotTreeImportSummary {
  templateId: string;
  nodeCount: number;
  choiceCount: number;
  endingCount: number;
}

async function request<T>(
  path: string,
  signal: AbortSignal,
  options?: { method?: string; body?: unknown }
): Promise<T> {
  const method = options?.method ?? (options?.body ? "POST" : "GET");
  const response = await fetch(adminUiApiPath(path), {
    method,
    signal,
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || result.code !== 200) {
    const errorMsg =
      result?.message ??
      result?.msg ??
      (Array.isArray(result?.errors)
        ? result.errors
            .map((e: unknown) =>
              e && typeof e === "object" && "message" in e ? String(e.message) : JSON.stringify(e)
            )
            .join("; ")
        : `Request failed (${response.status})`);
    throw new Error(errorMsg);
  }
  return result.data as T;
}

export function TaskTemplatesPanel() {
  const [projectType, setProjectType] = useState<ProjectType>("interactive_film");
  const [template, setTemplate] = useState<ProjectTaskTemplate | null>(null);
  const [itemsDraft, setItemsDraft] = useState<TaskTemplateItem[]>([]);
  const [templateName, setTemplateName] = useState<string>("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // Plot tree import state
  const [plotTreeJson, setPlotTreeJson] = useState("");
  const [importSummary, setImportSummary] = useState<PlotTreeImportSummary | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importPending, setImportPending] = useState(false);

  const active = useRef<AbortController | null>(null);

  async function loadTemplate(type: ProjectType) {
    if (active.current) {
      active.current.abort();
    }
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError(null);
    setSaveSuccess(null);

    try {
      const templates = await request<ProjectTaskTemplate[]>(
        `/api/admin/project-task-templates?projectType=${encodeURIComponent(type)}`,
        controller.signal
      );
      if (!controller.signal.aborted) {
        const activeTpl = templates.find((t) => t.active) ?? templates[0] ?? null;
        setTemplate(activeTpl);
        setTemplateName(
          activeTpl?.name ?? (type === "interactive_film" ? "影游标准模板" : "短剧标准模板")
        );
        setItemsDraft(
          activeTpl?.definition?.items ? structuredClone(activeTpl.definition.items) : []
        );
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        setPending(false);
      }
    }
  }

  useEffect(() => {
    let disposed = false;
    void Promise.resolve().then(() => {
      if (!disposed) void loadTemplate(projectType);
    });
    return () => {
      disposed = true;
      active.current?.abort();
      active.current = null;
    };
  }, [projectType]);

  function updateDraftItem(index: number, patch: Partial<TaskTemplateItem>) {
    setItemsDraft((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  async function handleSave() {
    if (pending) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError(null);
    setSaveSuccess(null);

    try {
      const updatedDefinition: TaskTemplateDefinition = {
        version: (template?.definition?.version ?? 0) + 1,
        items: itemsDraft,
        ...(template?.definition?.plotTree ? { plotTree: template.definition.plotTree } : {}),
      };

      const saved = await request<ProjectTaskTemplate>(
        `/api/admin/project-task-templates/${encodeURIComponent(projectType)}`,
        controller.signal,
        {
          method: "PUT",
          body: {
            name: templateName.trim() || `${projectType} template`,
            definition: updatedDefinition,
          },
        }
      );

      if (!controller.signal.aborted) {
        setTemplate(saved);
        setTemplateName(saved.name);
        setItemsDraft(saved.definition?.items ? structuredClone(saved.definition.items) : []);
        setSaveSuccess(`Template saved successfully as version ${saved.version}.`);
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        setPending(false);
      }
    }
  }

  async function handleImportPlotTree() {
    if (importPending) return;
    setImportError(null);
    setImportSummary(null);

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(plotTreeJson.trim());
    } catch (e) {
      setImportError(`Invalid JSON format: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    const controller = new AbortController();
    setImportPending(true);

    try {
      const summary = await request<PlotTreeImportSummary>(
        "/api/admin/project-task-templates/import/plot-tree",
        controller.signal,
        {
          method: "POST",
          body: parsedJson,
        }
      );
      setImportSummary(summary);
      setPlotTreeJson("");
      // Refetch current project type templates
      void loadTemplate(projectType);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportPending(false);
    }
  }

  return (
    <main className="space-y-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">项目任务模板管理 (Task Templates)</h1>
        <p className="text-sm text-slate-500">
          Manage task template items and plot tree configurations for project types.
        </p>
      </div>

      {/* Project Type Selector & Header Actions */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label htmlFor="project-type-select" className="text-sm font-medium">
            Project Type:
          </label>
          <Select
            value={projectType}
            onValueChange={(val) => setProjectType(val as ProjectType)}
            disabled={pending}
          >
            <SelectTrigger id="project-type-select" className="w-48">
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="interactive_film">interactive_film (影游)</SelectItem>
              <SelectItem value="series">series (短剧)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button variant="outline" disabled={pending} onClick={() => void loadTemplate(projectType)}>
          Refresh
        </Button>

        <Button disabled={pending || itemsDraft.length === 0} onClick={() => void handleSave()}>
          Save Template
        </Button>
      </div>

      {pending ? (
        <p role="status" className="text-sm text-slate-500">
          Loading / saving template…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive font-medium">
          {error}
        </p>
      ) : null}
      {saveSuccess ? <p className="text-sm text-emerald-600 font-medium">{saveSuccess}</p> : null}

      {/* Template Info Meta */}
      {template ? (
        <div className="flex flex-wrap items-center gap-6 rounded-lg border bg-card p-4 text-sm">
          <div>
            <span className="text-muted-foreground">Active Version:</span>{" "}
            <span className="font-semibold">{template.version}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Template ID:</span>{" "}
            <span className="font-mono text-xs">{template.id}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Template Name:</span>
            <Input
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              className="h-7 w-64 text-sm"
              placeholder="Template name"
              disabled={pending}
            />
          </div>
        </div>
      ) : null}

      {/* Template Items Table */}
      <div className="space-y-2">
        <h2 className="text-base font-semibold">Template Items ({itemsDraft.length})</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Key</TableHead>
              <TableHead className="min-w-36">Title</TableHead>
              <TableHead className="w-32">Category</TableHead>
              <TableHead className="min-w-44">Role Requirement</TableHead>
              <TableHead className="w-24">Unit</TableHead>
              <TableHead className="w-28">Min Price</TableHead>
              <TableHead className="min-w-36">Dependencies</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {itemsDraft.map((item, idx) => (
              <TableRow key={item.templateKey || idx}>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {item.templateKey}
                </TableCell>
                <TableCell>
                  <Input
                    value={item.title}
                    disabled={pending}
                    onChange={(e) => updateDraftItem(idx, { title: e.target.value })}
                    className="h-7 text-sm"
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={item.category}
                    disabled={pending}
                    onValueChange={(val) => updateDraftItem(idx, { category: val as TaskCategory })}
                  >
                    <SelectTrigger className="h-7 w-28 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="creative">creative</SelectItem>
                      <SelectItem value="production">production</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Input
                    value={item.roleRequirement}
                    disabled={pending}
                    onChange={(e) => updateDraftItem(idx, { roleRequirement: e.target.value })}
                    className="h-7 text-sm"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={item.unit}
                    disabled={pending}
                    onChange={(e) => updateDraftItem(idx, { unit: e.target.value })}
                    className="h-7 text-sm"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    value={item.priceRange?.min ?? ""}
                    disabled={pending}
                    onChange={(e) => {
                      const val = e.target.value === "" ? 0 : Number(e.target.value);
                      updateDraftItem(idx, {
                        priceRange: {
                          ...item.priceRange,
                          min: isNaN(val) ? 0 : val,
                        },
                      });
                    }}
                    className="h-7 text-sm"
                  />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {item.defaultDependencies?.length > 0 ? item.defaultDependencies.join(", ") : "—"}
                </TableCell>
              </TableRow>
            ))}
            {!pending && itemsDraft.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                  No items configured for this template.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      {/* Plot Tree Import Section for interactive_film */}
      {projectType === "interactive_film" ? (
        <div className="space-y-4 rounded-lg border bg-card p-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">Import Plot Tree (JSON)</h2>
            <p className="text-sm text-slate-500">
              Paste a valid plot tree JSON to create or update the interactive film task template.
            </p>
          </div>

          <Textarea
            value={plotTreeJson}
            onChange={(e) => setPlotTreeJson(e.target.value)}
            placeholder={`{\n  "title": "My Interactive Film",\n  "startNodeId": "scene_1",\n  "nodes": [\n    {\n      "id": "scene_1",\n      "type": "scene",\n      "transitions": [{ "to": "choice_1" }]\n    },\n    ...\n  ]\n}`}
            className="font-mono text-xs min-h-36"
            disabled={importPending}
          />

          <div className="flex items-center gap-4">
            <Button
              disabled={importPending || !plotTreeJson.trim()}
              onClick={() => void handleImportPlotTree()}
            >
              {importPending ? "Importing…" : "Import plot tree"}
            </Button>
          </div>

          {importError ? (
            <p role="alert" className="text-sm text-destructive font-medium">
              {importError}
            </p>
          ) : null}

          {importSummary ? (
            <div className="rounded border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-200">
              <p className="font-semibold mb-1">Plot Tree Import Successful:</p>
              <ul className="list-disc list-inside space-y-0.5 text-xs">
                <li>
                  Template ID: <span className="font-mono">{importSummary.templateId}</span>
                </li>
                <li>Node Count: {importSummary.nodeCount}</li>
                <li>Choice Count: {importSummary.choiceCount}</li>
                <li>Ending Count: {importSummary.endingCount}</li>
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
