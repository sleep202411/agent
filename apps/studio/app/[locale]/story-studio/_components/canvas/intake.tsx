"use client";

import type { ChangeEvent, RefObject } from "react";
import type { EmptyCanvasStarter } from "./use-story-generation";

/** The empty-canvas StoryOS intake: prompt bar, text-document upload, and
 *  the plaza-IP starter cards. Visibility is the parent's decision. */
export function CanvasIntake({
  prompt,
  onPromptChange,
  inputRef,
  uploadRef,
  onUploadChange,
  uploadName,
  analyzeState,
  analyzeError,
  starters,
  onStarterClick,
  onGenerate,
  leftDockWidth,
}: {
  prompt: string;
  onPromptChange: (value: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  uploadRef: RefObject<HTMLInputElement | null>;
  onUploadChange: (event: ChangeEvent<HTMLInputElement>) => void;
  uploadName: string | null;
  analyzeState: "idle" | "loading" | "error";
  analyzeError: string | null;
  starters: EmptyCanvasStarter[];
  onStarterClick: (starter: EmptyCanvasStarter) => void;
  onGenerate: () => void;
  leftDockWidth: number;
}) {
  return (
    <section
      className="pointer-events-none absolute bottom-0 top-[104px] z-10 flex items-center justify-center overflow-hidden px-8 transition-[left] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
      style={{ left: leftDockWidth, right: 0 }}
      aria-label="StoryOS empty canvas intake"
    >
      <div className="pointer-events-auto w-full max-w-[1160px] text-center">
        <p className="text-[15px] text-white/45">
          Double-click the canvas or describe what to generate.
        </p>

        <div className="mx-auto mt-7 flex h-[64px] max-w-[920px] items-center gap-2 rounded-full bg-white/[0.105] p-2 shadow-[0_24px_90px_rgba(0,0,0,0.34)] backdrop-blur-2xl">
          <input
            ref={inputRef}
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="Describe the story you want StoryOS to generate..."
            className="h-full min-w-0 flex-1 bg-transparent px-6 text-[15px] font-light text-white/85 outline-none placeholder:text-white/35"
          />
          <input
            ref={uploadRef}
            type="file"
            accept=".txt,.md,.json,text/plain,text/markdown,application/json"
            className="hidden"
            onChange={onUploadChange}
          />
          <button
            type="button"
            onClick={() => uploadRef.current?.click()}
            className="inline-flex h-12 shrink-0 items-center justify-center rounded-full bg-white/10 px-6 text-[14px] font-medium text-white/72 transition hover:bg-white/15 hover:text-white active:translate-y-0.5"
          >
            {uploadName ? "Uploaded" : "Upload"}
          </button>
          <button
            type="button"
            onClick={onGenerate}
            className="inline-flex h-12 shrink-0 items-center justify-center rounded-full bg-[#E52227] px-7 text-[14px] font-medium text-white shadow-[0_7px_0_0_rgba(122,14,17,0.9)] transition-[translate,box-shadow,background] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-[#ff3d42] active:translate-y-1 active:shadow-[0_2px_0_0_rgba(122,14,17,0.9)]"
          >
            Generate
          </button>
        </div>

        {uploadName ? (
          <p className="mt-3 text-xs font-medium text-white/36">
            Selected text document: {uploadName}
          </p>
        ) : null}

        {analyzeState === "error" && analyzeError ? (
          <p className="mx-auto mt-3 max-w-[760px] text-sm font-medium leading-6 text-[#ff8b8e]">
            {analyzeError}
          </p>
        ) : null}

        <div className="mt-7 grid grid-cols-4 gap-4">
          {starters.map((starter) => (
            <button
              key={starter.key}
              type="button"
              onClick={() => onStarterClick(starter)}
              className="group relative h-[96px] overflow-hidden rounded-[22px] bg-cover bg-center p-5 text-left shadow-[0_22px_72px_rgba(0,0,0,0.26)] transition duration-200 hover:-translate-y-1 hover:shadow-[0_30px_90px_rgba(0,0,0,0.42)]"
              style={{
                backgroundImage: starter.image
                  ? `linear-gradient(90deg, rgba(18,18,18,0.86), rgba(18,18,18,0.48)), url(${starter.image})`
                  : "linear-gradient(90deg, oklch(0.22 0 0), oklch(0.17 0 0))",
              }}
            >
              <span className="absolute inset-0 bg-black/18 opacity-0 transition group-hover:opacity-100" />
              <span className="relative block text-[15px] font-semibold leading-tight text-white/94">
                {starter.title}
              </span>
              <span className="relative mt-1.5 block text-[12px] font-medium leading-5 text-white/56 transition group-hover:text-white/68">
                {starter.description}
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
