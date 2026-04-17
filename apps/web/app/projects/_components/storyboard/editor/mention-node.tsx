import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useReferenceMap } from "./reference-map-context";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MentionType = "character" | "scene" | "prop" | "reference";

export interface MentionItem {
  id: string;
  label: string;
  mentionType: MentionType;
  imgUrl?: string;
  voiceId?: string;
  model?: string;
}

// ---------------------------------------------------------------------------
// React NodeView component
// ---------------------------------------------------------------------------

const chipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "4px",
  height: "22px",
  borderRadius: "9999px",
  backgroundColor: "#3a3a3a",
  paddingLeft: "8px",
  paddingRight: "6px",
  verticalAlign: "middle",
  fontSize: "13px",
  lineHeight: 1,
  color: "#cccccc",
  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.15)",
  cursor: "pointer",
  userSelect: "none",
  whiteSpace: "nowrap",
};

const chipWithAvatarStyle: React.CSSProperties = {
  ...chipStyle,
  paddingLeft: "4px",
};

const avatarStyle: React.CSSProperties = {
  width: "16px",
  height: "16px",
  borderRadius: "9999px",
  objectFit: "cover",
  flexShrink: 0,
};

const nameStyle: React.CSSProperties = {
  maxWidth: "120px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const chevronStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  color: "#888888",
  flexShrink: 0,
};

const audioIconSvg = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
const videoIconSvg = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`;

function MentionChipView({ node }: NodeViewProps) {
  const { id, label, imgUrl, mentionType } = node.attrs as {
    id: string;
    label: string;
    mentionType: MentionType;
    imgUrl: string;
    voiceId: string;
    model: string;
  };

  const refMap = useReferenceMap();
  const refEntry = refMap.map.get(id) ?? refMap.map.get(imgUrl);
  const isInvalid = refEntry ? !refEntry.valid : false;
  const displayLabel = refEntry?.displayLabel || label;
  const mediaKind =
    refEntry?.mediaType ?? (mentionType === "reference" && !imgUrl ? "audio" : "image");
  const isVideo = mediaKind === "video";
  const isAudio = mediaKind === "audio";
  const hasAvatar = Boolean(imgUrl) && !isVideo && !isAudio;

  const invalidStyle: React.CSSProperties = isInvalid
    ? { opacity: 0.45, textDecoration: "line-through", filter: "grayscale(1)" }
    : {};

  return (
    <NodeViewWrapper as="span" data-mention-chip="" style={{ display: "inline", lineHeight: 1 }}>
      <span
        role="button"
        tabIndex={-1}
        style={{
          ...(hasAvatar ? chipWithAvatarStyle : chipStyle),
          ...(isInvalid ? { backgroundColor: "#2a2a2a" } : {}),
        }}
        onMouseEnter={(e) => {
          if (isInvalid) return;
          const el = e.currentTarget;
          el.style.backgroundColor = "#4a4a4a";
          el.style.boxShadow = "inset 0 0 0 1px rgba(255,255,255,0.25)";
        }}
        onMouseLeave={(e) => {
          if (isInvalid) return;
          const el = e.currentTarget;
          el.style.backgroundColor = "#3a3a3a";
          el.style.boxShadow = "inset 0 0 0 1px rgba(255,255,255,0.15)";
        }}
      >
        {hasAvatar ? (
          <img src={imgUrl} alt="" style={{ ...avatarStyle, ...invalidStyle }} />
        ) : isVideo || isAudio ? (
          <span
            style={{
              ...avatarStyle,
              ...invalidStyle,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#444",
              borderRadius: "9999px",
            }}
            dangerouslySetInnerHTML={{ __html: isVideo ? videoIconSvg : audioIconSvg }}
          />
        ) : null}
        <span style={{ ...nameStyle, ...invalidStyle }}>{displayLabel}</span>
        <span style={chevronStyle}>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
            <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
          </svg>
        </span>
      </span>
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------------------
// Tiptap Node extension
// ---------------------------------------------------------------------------

export const MentionNode = Node.create({
  name: "mentionChip",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      id: { default: "" },
      label: { default: "" },
      mentionType: { default: "character" as MentionType },
      imgUrl: { default: "" },
      voiceId: { default: "" },
      model: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "mention",
        getAttrs: (node) => {
          const el = node as HTMLElement;
          return {
            id: el.getAttribute("id") ?? "",
            label: el.textContent ?? "",
            mentionType: el.getAttribute("type") ?? "character",
            imgUrl:
              el.getAttribute("imgUrl") ??
              el.getAttribute("imageUrl") ??
              el.getAttribute("mediaUrl") ??
              "",
            voiceId: el.getAttribute("voiceId") ?? "",
            model: el.getAttribute("model") ?? "",
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const attrs: Record<string, string> = {
      id: node.attrs.id as string,
      type: node.attrs.mentionType as string,
    };
    if (node.attrs.imgUrl) attrs.imgUrl = node.attrs.imgUrl as string;
    if (node.attrs.voiceId) attrs.voiceId = node.attrs.voiceId as string;
    if (node.attrs.model) attrs.model = node.attrs.model as string;
    return ["mention", mergeAttributes(attrs), node.attrs.label as string];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MentionChipView, {
      as: "span",
      className: "mention-chip-wrapper",
    });
  },
});
