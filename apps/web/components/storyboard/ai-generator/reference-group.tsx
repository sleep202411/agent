import { IconMusic, IconPlus, IconSparkles, IconVideo, IconX } from "@tabler/icons-react";

// ─── Types ──────────────────────────────────────────

export interface ReferenceItem {
  url?: string;
  path: string;
  label?: string;
}

export interface ReferenceGroupProps {
  /** Button label for adding new items */
  label: string;
  /** Current items */
  items: ReferenceItem[];
  /** Maximum number of items allowed */
  maxCount: number;
  /** Called when user clicks the add button */
  onAdd: () => void;
  /** Called when user removes an item by index */
  onRemove: (index: number) => void;
  /** Function to resolve a storage path to a display URL */
  resolveUrl?: (path: string) => string;
  /** Function to get video thumbnail URL */
  resolveVideoThumbnail?: (path: string) => string;
}

// ─── Helpers ────────────────────────────────────────

const ROTATION_ANGLES = [-3.5, 2, -1.5, 3, -2.5, 1.5, -4, 2.5];

function detectMediaType(path: string): "image" | "video" | "audio" {
  if (/\.(mp4|webm|mov)(\?|$)/i.test(path)) return "video";
  if (/\.(mp3|wav|ogg|aac|flac|m4a)(\?|$)/i.test(path)) return "audio";
  return "image";
}

// ─── Component ──────────────────────────────────────

export function ReferenceGroup({
  label,
  items,
  maxCount,
  onAdd,
  onRemove,
  resolveUrl = (p) => p,
  resolveVideoThumbnail,
}: ReferenceGroupProps) {
  return (
    <div className="relative flex items-end gap-3">
      {items.map((item, index) => {
        const rawPath = item.url || item.path;
        const mediaType = detectMediaType(rawPath);
        const rotation = ROTATION_ANGLES[index % ROTATION_ANGLES.length];

        let src = "";
        if (mediaType === "video" && resolveVideoThumbnail) {
          src = resolveVideoThumbnail(rawPath);
        } else if (mediaType !== "audio") {
          src = item.url || resolveUrl(item.path);
        }

        return (
          <div
            key={`${item.path}-${index}`}
            className="group relative h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-muted shadow-lg ring-1 ring-white/10 transition-transform hover:scale-105 hover:!rotate-0"
            style={{ transform: `rotate(${rotation}deg)` }}
          >
            {mediaType === "audio" ? (
              <div className="flex h-full w-full items-center justify-center bg-secondary text-muted-foreground/60">
                <IconMusic className="size-5" />
              </div>
            ) : src ? (
              <img src={src} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
                {mediaType === "video" ? (
                  <IconVideo className="size-4" />
                ) : (
                  <IconSparkles className="size-4" />
                )}
              </div>
            )}
            {mediaType === "video" && (
              <div className="absolute left-1 top-1 flex size-4 items-center justify-center rounded bg-black/60 text-white">
                <IconVideo className="size-2.5" />
              </div>
            )}
            <button
              type="button"
              onClick={() => onRemove(index)}
              className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
            >
              <IconX className="size-2.5" />
            </button>
          </div>
        );
      })}
      {items.length < maxCount && (
        <button
          type="button"
          onClick={onAdd}
          className="flex h-20 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-lg bg-white/[0.06] text-muted-foreground transition-colors hover:bg-white/[0.1] hover:text-primary"
        >
          <IconPlus className="size-3.5" />
          <span className="text-[9px]">{label}</span>
        </button>
      )}
    </div>
  );
}
