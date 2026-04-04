"use client";

import { useRef, useState } from "react";
import { IconSparkles, IconPlus, IconX, IconFile, IconMovie } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "motion/react";
import { api } from "@/src/lib/api";
import { useAppSelector, useAppDispatch } from "@/src/store";
import { initAgent, setTaskId } from "@/src/store/slices/agentSlice";

// ─── Component ───────────────────────────────────────────

export function CreationComposer() {
  const dispatch = useAppDispatch();
  const t = useTranslations("workspace");
  const tc = useTranslations("common");
  const [isExpanded, setIsExpanded] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [uploadedText, setUploadedText] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleExpand = () => {
    setIsExpanded(true);
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setUploadedText(text);
      setUploadedFileName(file.name);
      if (!prompt.trim()) {
        setPrompt(`基于上传的小说《${file.name.replace(/\.[^.]+$/, "")}》生成短剧视频`);
      }
    };
    reader.readAsText(file);
  };

  const handleCreate = async () => {
    if (!prompt.trim() && !uploadedText) return;

    const id = crypto.randomUUID();
    dispatch(initAgent({ id, prompt: prompt.trim() }));

    try {
      const task = await api.post<{ id: string }>("/aurora/api/tasks", {
        data: {
          type: "agent",
          input: {
            prompt: prompt.trim(),
            text: uploadedText ?? undefined,
            totalSteps: 3,
          },
        },
      });
      dispatch(setTaskId(task.id));
    } catch (err) {
      console.warn("[CreationComposer] Failed to create task:", err);
    }

    setPrompt("");
    setUploadedText(null);
    setUploadedFileName(null);
    setIsExpanded(false);
  };

  const canSubmit = prompt.trim() || uploadedText;

  return (
    <>
      {/* Backdrop */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
            onClick={() => setIsExpanded(false)}
          />
        )}
      </AnimatePresence>

      {/* Composer */}
      <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-6">
        <AnimatePresence mode="wait">
          {!isExpanded ? (
            /* ─── Collapsed pill ─── */
            <motion.button
              key="collapsed"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              type="button"
              onClick={handleExpand}
              className="flex items-center gap-2.5 rounded-full border border-border/70 bg-card px-5 py-3 shadow-lg transition-colors hover:border-primary/40 hover:bg-card/90"
            >
              <IconSparkles className="size-4 text-primary" />
              <span className="text-sm text-muted-foreground">{t("promptPlaceholder")}</span>
            </motion.button>
          ) : (
            /* ─── Expanded composer ─── */
            <motion.div
              key="expanded"
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-3xl rounded-2xl border border-border/70 bg-card shadow-2xl"
            >
              {/* Input area */}
              <div className="flex gap-3 p-4">
                {/* Upload button */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md,.text"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-20 w-14 shrink-0 items-center justify-center rounded-xl border border-dashed border-muted-foreground/25 bg-muted/20 text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
                >
                  <IconPlus className="size-5" />
                </button>

                {/* Text input */}
                <div className="flex flex-1 flex-col gap-2">
                  {uploadedFileName && (
                    <div className="flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
                      <IconFile className="size-3.5 shrink-0" />
                      <span className="truncate">{uploadedFileName}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setUploadedText(null);
                          setUploadedFileName(null);
                        }}
                        className="ml-auto shrink-0 rounded-sm p-0.5 hover:bg-muted hover:text-foreground"
                      >
                        <IconX className="size-3" />
                      </button>
                    </div>
                  )}
                  <textarea
                    ref={textareaRef}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) {
                        e.preventDefault();
                        handleCreate();
                      }
                    }}
                    placeholder={t("promptPlaceholder")}
                    rows={2}
                    className="flex-1 resize-none bg-transparent text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
                  />
                </div>
              </div>

              {/* Toolbar */}
              <div className="flex items-center justify-between px-4 pb-3">
                <div className="flex items-center gap-1.5">
                  <span className="flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
                    <IconMovie className="size-3.5" />
                    短剧 Agent
                  </span>
                </div>
                <Button
                  size="sm"
                  className="shrink-0 rounded-lg px-5 font-semibold"
                  disabled={!canSubmit}
                  onClick={handleCreate}
                >
                  <IconSparkles className="size-3.5" />
                  {tc("create")}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
