import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MentionType = "character" | "scene" | "prop";

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

function MentionChipView({ node }: NodeViewProps) {
  const { label, imgUrl } = node.attrs as {
    id: string;
    label: string;
    mentionType: MentionType;
    imgUrl: string;
    voiceId: string;
    model: string;
  };

  const hasAvatar = Boolean(imgUrl);

  return (
    <NodeViewWrapper as="span" data-mention-chip="" style={{ display: "inline", lineHeight: 1 }}>
      <span
        role="button"
        tabIndex={-1}
        style={hasAvatar ? chipWithAvatarStyle : chipStyle}
        onMouseEnter={(e) => {
          const el = e.currentTarget;
          el.style.backgroundColor = "#4a4a4a";
          el.style.boxShadow = "inset 0 0 0 1px rgba(255,255,255,0.25)";
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget;
          el.style.backgroundColor = "#3a3a3a";
          el.style.boxShadow = "inset 0 0 0 1px rgba(255,255,255,0.15)";
        }}
      >
        {hasAvatar ? <img src={imgUrl} alt="" style={avatarStyle} /> : null}
        <span style={nameStyle}>{label}</span>
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
