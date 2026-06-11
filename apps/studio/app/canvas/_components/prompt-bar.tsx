"use client";

import { useState } from "react";
import { IconSparkles } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3"] as const;
const IMAGE_COUNTS = ["1", "2", "4"] as const;

/**
 * Floating composer — the canvas hero control. Generation is not wired to a
 * backend yet, so Generate surfaces that honestly instead of pretending.
 */
export function PromptBar() {
  const [prompt, setPrompt] = useState("");

  return (
    <div className="absolute bottom-6 left-1/2 z-10 w-[640px] max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-2xl bg-popover/90 p-2 shadow-xl backdrop-blur-xl">
      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe what you want to create…"
        className="min-h-12 resize-none bg-transparent text-sm"
      />
      <div className="flex items-center gap-2 pt-1">
        <Select defaultValue="1:1">
          <SelectTrigger aria-label="Aspect ratio">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ASPECT_RATIOS.map((ratio) => (
              <SelectItem key={ratio} value={ratio}>
                {ratio}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select defaultValue="1">
          <SelectTrigger aria-label="Image count">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {IMAGE_COUNTS.map((count) => (
              <SelectItem key={count} value={count}>
                {count === "1" ? "1 image" : `${count} images`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <Button
          size="sm"
          className="rounded-full px-4"
          onClick={() => toast.info("Generation · Coming soon")}
        >
          <IconSparkles className="size-4" />
          Generate
        </Button>
      </div>
    </div>
  );
}
