"use client";

import { useRef, useState } from "react";
import { IconSparkles, IconDice5, IconUpload, IconFile, IconX } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { motion, AnimatePresence } from "motion/react";
import { api } from "@/src/lib/api";
import { useAppSelector, useAppDispatch } from "@/src/store";
import { initAgent, setTaskId } from "@/src/store/slices/agentSlice";

// ─── Prompt Templates ───────────────────────────────────────

const promptTemplates = [
  "A cyberpunk city at night, neon lights reflecting on wet streets, a lone figure walking through the rain, cinematic atmosphere",
  "Ancient Chinese palace during cherry blossom season, a young warrior standing on the rooftop overlooking the city, anime style",
  "A spaceship landing on an alien planet with purple vegetation, two astronauts stepping out, sci-fi short film",
  "A cozy café in Paris on a rainy afternoon, a writer sitting by the window typing on a vintage typewriter, warm lighting",
  "Underwater kingdom with bioluminescent creatures, a mermaid princess swimming through coral castles, fantasy animation",
  "Post-apocalyptic Tokyo, nature reclaiming the city, a girl and her robot companion exploring overgrown skyscrapers",
  "A detective investigating a mysterious case in 1920s Shanghai, noir style with dramatic shadows and fog",
  "A magical forest where animals can talk, a young fox embarking on a journey to find the legendary golden tree",
  "Futuristic racing competition on Mars, hovercrafts speeding through red canyons, intense action sequence",
  "A grandmother telling bedtime stories to her grandchildren, each story comes alive as beautiful illustrations around them",
];

// ─── Component ──────────────────────────────────────────────

export function CreationStation({ className }: { className?: string }) {
  const dispatch = useAppDispatch();
  const t = useTranslations("workspace");
  const [prompt, setPrompt] = useState("");
  const [uploadedText, setUploadedText] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  const handleRandomPrompt = () => {
    const filtered = promptTemplates.filter((t) => t !== prompt);
    const random = filtered[Math.floor(Math.random() * filtered.length)]!;
    setPrompt(random);
  };

  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setUploadedText(text);
      setUploadedFileName(file.name);
      if (!prompt.trim()) {
        setPrompt(t("novelOutlineTemplate", { name: file.name.replace(/\.[^.]+$/, "") }));
      }
    };
    reader.readAsText(file);
  };

  const handleClearUpload = () => {
    setUploadedText(null);
    setUploadedFileName(null);
  };

  const handleCreate = async () => {
    if (!prompt.trim() && !uploadedText) return;

    const id = crypto.randomUUID();
    dispatch(initAgent({ id, prompt: prompt.trim() }));

    // Create persistent task on backend (non-blocking)
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
      console.warn("[CreationStation] Failed to create task:", err);
    }
  };

  return (
    <section className={cn("mx-auto w-full max-w-3xl", className)}>
      {/* Headline */}
      <AnimatePresence mode="wait">
        <motion.h2
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="text-5xl font-bold leading-tight text-center"
        >
          From script to screen
          <br />
          <span className="bg-gradient-to-r from-primary via-red-400 to-primary bg-clip-text text-transparent animate-[shimmer_3s_ease-in-out_infinite] bg-[length:200%_100%]">
            AI-powered animation creation
          </span>
        </motion.h2>
      </AnimatePresence>

      {/* Prompt Composer — gradient border wrapper */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className={cn(
          "relative mt-6 rounded-2xl p-px transition-all duration-500",
          isFocused
            ? "bg-gradient-to-r from-primary/80 via-red-400/60 to-primary/80 shadow-[0_0_24px_-4px_oklch(0.591_0.225_26.8/0.3)]"
            : "bg-border"
        )}
      >
        <div className="rounded-2xl bg-card">
          {/* Input area */}
          <div className="flex gap-3 p-4">
            <UploadBox onFileSelect={handleFileUpload} />
            <div className="flex flex-1 flex-col gap-2">
              {uploadedFileName && (
                <div className="flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
                  <IconFile className="size-3.5 shrink-0" />
                  <span className="truncate">{uploadedFileName}</span>
                  <button
                    type="button"
                    onClick={handleClearUpload}
                    className="ml-auto shrink-0 rounded-sm p-0.5 hover:bg-muted hover:text-foreground"
                  >
                    <IconX className="size-3" />
                  </button>
                </div>
              )}
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                placeholder="Describe your story, upload a novel, or tell us what you want to create..."
                rows={3}
                className="flex-1 resize-none bg-transparent text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
              />
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex items-center justify-between px-4 py-2.5">
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    color="muted"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={handleRandomPrompt}
                  >
                    <IconDice5 className="size-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Random prompt</TooltipContent>
              </Tooltip>
            </div>

            <div className="flex items-center gap-3">
              <Button
                size="lg"
                className="rounded-xl px-6 text-base font-semibold shadow-[0_0_16px_-2px_oklch(0.591_0.225_26.8/0.4)] transition-shadow hover:shadow-[0_0_24px_-2px_oklch(0.591_0.225_26.8/0.5)]"
                disabled={!prompt.trim() && !uploadedText}
                onClick={handleCreate}
              >
                <IconSparkles className="size-4" />
                Create
              </Button>
            </div>
          </div>
        </div>
      </motion.div>
    </section>
  );
}

// ─── Upload Box ─────────────────────────────────────────────

function UploadBox({ onFileSelect }: { onFileSelect: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".txt,.md,.text"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileSelect(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="group flex h-24 w-20 shrink-0 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-muted-foreground/25 bg-muted/20 text-muted-foreground transition-all duration-200 hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
      >
        <IconUpload className="size-5 transition-transform duration-200 group-hover:scale-110" />
        <span className="text-[10px] font-medium opacity-60 group-hover:opacity-100">Upload</span>
      </button>
    </>
  );
}
