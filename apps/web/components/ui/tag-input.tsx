"use client";

/**
 * TagInput — chip-style tag entry following shadcn primitives.
 *
 *   - Enter / `,` / `;` / 中文 ， 、 ； adds the current draft as a tag
 *   - Backspace on an empty input pops the last tag
 *   - Click ×  on a chip removes that one
 *   - onBlur with non-empty draft commits as a tag (don't lose typing)
 *   - Duplicates silently dedup
 *   - Honors `maxTags` (input disables once reached) + `maxLength` per tag
 *
 * Visually matches the `Input` primitive (same border, focus ring,
 * height) so it can slot anywhere a text Input would go.
 */

import { useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

interface TagInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  maxTags?: number;
  /** Per-tag character cap. */
  maxLength?: number;
  disabled?: boolean;
  className?: string;
  id?: string;
}

const SEPARATOR_RE = /[,，、;；]/;

export function TagInput({
  value,
  onChange,
  placeholder,
  maxTags = 20,
  maxLength = 64,
  disabled = false,
  className,
  id,
}: TagInputProps) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const addTag = (raw: string) => {
    const t = raw.trim().slice(0, maxLength);
    if (!t) return;
    if (value.includes(t)) return;
    if (value.length >= maxTags) return;
    onChange([...value, t]);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (draft.trim()) {
        addTag(draft);
        setDraft("");
      }
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    if (SEPARATOR_RE.test(next)) {
      // Split on any separator; everything before the last fragment
      // becomes a tag, the last fragment stays as draft. Lets the
      // user paste "Final Draft, 分镜思维" and get 2 tags.
      const parts = next.split(SEPARATOR_RE);
      const last = parts.pop() ?? "";
      parts.forEach(addTag);
      setDraft(last);
    } else {
      setDraft(next);
    }
  };

  const handleBlur = () => {
    if (draft.trim()) {
      addTag(draft);
      setDraft("");
    }
  };

  const removeTag = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  const reachedMax = value.length >= maxTags;

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      className={cn(
        "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 text-sm transition-colors",
        "focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-ring/20",
        disabled && "cursor-not-allowed opacity-60",
        className
      )}
    >
      {value.map((tag, i) => (
        <span
          key={`${tag}-${i}`}
          className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-xs text-primary"
        >
          <span className="max-w-[12rem] truncate">{tag}</span>
          {!disabled && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeTag(i);
              }}
              className="rounded-sm hover:bg-primary/20"
              aria-label={`Remove ${tag}`}
            >
              <IconX className="size-3" />
            </button>
          )}
        </span>
      ))}
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={draft}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={value.length === 0 ? placeholder : ""}
        maxLength={maxLength}
        disabled={disabled || reachedMax}
        className="min-w-[80px] flex-1 bg-transparent px-1 outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed"
      />
    </div>
  );
}
