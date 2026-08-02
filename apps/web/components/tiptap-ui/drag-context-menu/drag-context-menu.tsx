"use client";

// ─── React & External Libraries ──────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Node as TiptapNode } from "@tiptap/pm/model";
import { offset } from "@floating-ui/react";
import { DragHandle } from "@tiptap/extension-drag-handle-react";

// ─── Types ────────────────────────────────────────────────────────────────────
import type {
  DragContextMenuProps,
  DragContextMenuLabels,
  MenuItemProps,
  NodeChangeData,
} from "@/components/tiptap-ui/drag-context-menu/drag-context-menu-types";

// ─── Hooks ────────────────────────────────────────────────────────────────────
import { useTiptapEditor } from "@/hooks/use-tiptap-editor";
import { useIsBreakpoint } from "@/hooks/use-is-breakpoint";
import { useUiEditorState } from "@/hooks/use-ui-editor-state";
import { selectNodeAndHideFloating } from "@/hooks/use-floating-toolbar-visibility";

// ─── Primitive UI Components ──────────────────────────────────────────────────
import { Button } from "@/components/tiptap-ui-primitive/button";
import { Spacer } from "@/components/tiptap-ui-primitive/spacer";
import { Separator } from "@/components/tiptap-ui-primitive/separator";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuGroup,
  MenuGroupLabel,
  MenuButton,
} from "@/components/tiptap-ui-primitive/menu";
import { Combobox, ComboboxList } from "@/components/tiptap-ui-primitive/combobox";

// ─── Tiptap UI — Hooks ────────────────────────────────────────────────────────
import { useDuplicate, DuplicateShortcutBadge } from "@/components/tiptap-ui/duplicate-button";
import {
  useCopyToClipboard,
  CopyToClipboardShortcutBadge,
} from "@/components/tiptap-ui/copy-to-clipboard-button";
import { useDeleteNode, DeleteNodeShortcutBadge } from "@/components/tiptap-ui/delete-node-button";
import {
  useCopyAnchorLink,
  CopyAnchorLinkShortcutBadge,
} from "@/components/tiptap-ui/copy-anchor-link-button";
import { useResetAllFormatting } from "@/components/tiptap-ui/reset-all-formatting-button";
import { useText } from "@/components/tiptap-ui/text-button";
import { useHeading } from "@/components/tiptap-ui/heading-button";
import { useList } from "@/components/tiptap-ui/list-button";
import { useBlockquote } from "@/components/tiptap-ui/blockquote-button";
import { useCodeBlock } from "@/components/tiptap-ui/code-block-button";

// ─── Tiptap UI — Components ───────────────────────────────────────────────────
import { SlashCommandTriggerButton } from "@/components/tiptap-ui/slash-command-trigger-button";
import { ColorMenu } from "@/components/tiptap-ui/color-menu";

// ─── Tiptap Node Extensions ───────────────────────────────────────────────────
import { TableAlignMenu } from "@/components/tiptap-node/table-node/ui/table-alignment-menu";
import { useTableFitToWidth } from "@/components/tiptap-node/table-node/ui/table-fit-to-width-button";
import { useTableClearRowColumnContent } from "@/components/tiptap-node/table-node/ui/table-clear-row-column-content-button";

// ─── Utils ────────────────────────────────────────────────────────────────────
import { isTextSelectionValid } from "@/lib/tiptap-editor-utils";
import { SR_ONLY } from "@/lib/tiptap-utils";

// ─── Icons ────────────────────────────────────────────────────────────────────
import { GripVerticalIcon } from "@/components/tiptap-icons/grip-vertical-icon";
import { ChevronRightIcon } from "@/components/tiptap-icons/chevron-right-icon";
import { Repeat2Icon } from "@/components/tiptap-icons/repeat-2-icon";

// ─── Styles ───────────────────────────────────────────────────────────────────
import "./drag-context-menu.scss";

const useNodeTransformActions = (labels: DragContextMenuLabels) => {
  const text = useText();
  const heading1 = useHeading({ level: 1 });
  const heading2 = useHeading({ level: 2 });
  const heading3 = useHeading({ level: 3 });
  const bulletList = useList({ type: "bulletList" });
  const orderedList = useList({ type: "orderedList" });
  const taskList = useList({ type: "taskList" });
  const blockquote = useBlockquote();
  const codeBlock = useCodeBlock();

  const mapper = (
    action: ReturnType<
      | typeof useText
      | typeof useHeading
      | typeof useList
      | typeof useBlockquote
      | typeof useCodeBlock
    >,
    label: string
  ) => ({
    icon: action.Icon,
    label,
    onClick: action.handleToggle,
    disabled: !action.canToggle,
    isActive: action.isActive,
  });

  const actions = [
    mapper(text, labels.paragraph),
    mapper(heading1, labels.heading1),
    mapper(heading2, labels.heading2),
    mapper(heading3, labels.heading3),
    mapper(bulletList, labels.bulletList),
    mapper(orderedList, labels.orderedList),
    mapper(taskList, labels.taskList),
    mapper(blockquote, labels.blockquote),
    mapper(codeBlock, labels.codeBlock),
  ];

  const allDisabled = actions.every((a) => a.disabled);

  return allDisabled ? null : actions;
};

const BaseMenuItem: React.FC<MenuItemProps> = ({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  isActive = false,
  shortcutBadge,
}) => (
  <MenuItem
    render={<Button variant="ghost" data-active-state={isActive ? "on" : "off"} />}
    onClick={onClick}
    disabled={disabled}
  >
    <Icon className="tiptap-button-icon" />
    <span className="tiptap-button-text">{label}</span>
    {shortcutBadge}
  </MenuItem>
);

const SubMenuTrigger: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}> = ({ icon: Icon, label, children }) => (
  <Menu
    placement="right"
    trigger={
      <MenuItem
        render={
          <MenuButton
            render={
              <Button variant="ghost">
                <Icon className="tiptap-button-icon" />
                <span className="tiptap-button-text">{label}</span>
                <Spacer />
                <ChevronRightIcon className="tiptap-button-icon" />
              </Button>
            }
          />
        }
      />
    }
  >
    <MenuContent portal>
      <ComboboxList>{children}</ComboboxList>
    </MenuContent>
  </Menu>
);

const TransformActionGroup: React.FC<{ labels: DragContextMenuLabels }> = ({ labels }) => {
  const actions = useNodeTransformActions(labels);
  const { canReset, handleResetFormatting, Icon } = useResetAllFormatting({
    hideWhenUnavailable: true,
    preserveMarks: ["inlineThread"],
  });

  if (!actions && !canReset) return null;

  return (
    <>
      {actions && (
        <SubMenuTrigger icon={Repeat2Icon} label={labels.turnInto}>
          <MenuGroup>
            <MenuGroupLabel>{labels.turnInto}</MenuGroupLabel>
            {actions.map((action) => (
              <BaseMenuItem key={action.label} {...action} />
            ))}
          </MenuGroup>
        </SubMenuTrigger>
      )}

      {canReset && (
        <BaseMenuItem
          icon={Icon}
          label={labels.resetFormatting}
          disabled={!canReset}
          onClick={handleResetFormatting}
        />
      )}
    </>
  );
};

const TableFitToWidth: React.FC<{ labels: DragContextMenuLabels }> = ({ labels }) => {
  const { canFitToWidth, handleFitToWidth, Icon } = useTableFitToWidth({
    hideWhenUnavailable: true,
  });
  const clearAllContents = useTableClearRowColumnContent({ resetAttrs: true });

  return (
    <>
      {canFitToWidth && (
        <BaseMenuItem
          icon={Icon}
          label={labels.fitTableToWidth}
          disabled={!canFitToWidth}
          onClick={handleFitToWidth}
        />
      )}

      {clearAllContents.canClearRowColumnContent && (
        <BaseMenuItem
          icon={clearAllContents.Icon}
          label={labels.clearContents}
          disabled={!clearAllContents.canClearRowColumnContent}
          onClick={clearAllContents.handleClear}
        />
      )}
    </>
  );
};

const CoreActionGroup: React.FC<{ labels: DragContextMenuLabels }> = ({ labels }) => {
  const { handleDuplicate, canDuplicate, Icon: DuplicateIcon } = useDuplicate();
  const { handleCopyToClipboard, canCopyToClipboard, Icon: CopyIcon } = useCopyToClipboard();
  const { handleCopyAnchorLink, canCopyAnchorLink, Icon: CopyAnchorLinkIcon } = useCopyAnchorLink();

  return (
    <>
      <Separator orientation="horizontal" />

      <MenuGroup>
        <BaseMenuItem
          icon={DuplicateIcon}
          label={labels.duplicate}
          onClick={handleDuplicate}
          disabled={!canDuplicate}
          shortcutBadge={<DuplicateShortcutBadge />}
        />
        <BaseMenuItem
          icon={CopyIcon}
          label={labels.copy}
          onClick={handleCopyToClipboard}
          disabled={!canCopyToClipboard}
          shortcutBadge={<CopyToClipboardShortcutBadge />}
        />
        <BaseMenuItem
          icon={CopyAnchorLinkIcon}
          label={labels.copyLink}
          onClick={handleCopyAnchorLink}
          disabled={!canCopyAnchorLink}
          shortcutBadge={<CopyAnchorLinkShortcutBadge />}
        />
      </MenuGroup>

      <Separator orientation="horizontal" />
    </>
  );
};

const DeleteActionGroup: React.FC<{ labels: DragContextMenuLabels }> = ({ labels }) => {
  const { handleDeleteNode, canDeleteNode, Icon } = useDeleteNode();

  return (
    <MenuGroup>
      <BaseMenuItem
        icon={Icon}
        label={labels.delete}
        onClick={handleDeleteNode}
        disabled={!canDeleteNode}
        shortcutBadge={<DeleteNodeShortcutBadge />}
      />
    </MenuGroup>
  );
};

export const DragContextMenu: React.FC<DragContextMenuProps> = ({
  editor: providedEditor,
  withSlashCommandTrigger = true,
  mobileBreakpoint = 768,
  labels,
  ...props
}) => {
  const { editor } = useTiptapEditor(providedEditor);
  const { isDragging } = useUiEditorState(editor);
  const isMobile = useIsBreakpoint("max", mobileBreakpoint);
  const [open, setOpen] = useState(false);
  const [node, setNode] = useState<TiptapNode | null>(null);
  const [nodePos, setNodePos] = useState<number>(-1);

  const handleNodeChange = useCallback((data: NodeChangeData) => {
    if (data.node) setNode(data.node);
    setNodePos(data.pos);
  }, []);

  useEffect(() => {
    if (!editor) return;
    editor.commands.setLockDragHandle(open);
    editor.commands.setMeta("lockDragHandle", open);
  }, [editor, open]);

  const mainAxisOffset = 16;

  const dynamicPositions = useMemo(() => {
    return {
      middleware: [
        offset((props) => {
          const { rects } = props;
          const nodeHeight = rects.reference.height;
          const dragHandleHeight = rects.floating.height;

          const crossAxis = nodeHeight / 2 - dragHandleHeight / 2;

          return {
            mainAxis: mainAxisOffset,
            // if height is more than 40px, then it's likely a block node
            crossAxis: nodeHeight > 40 ? 0 : crossAxis,
          };
        }),
      ],
    };
  }, []);

  const handleOnMenuClose = useCallback(() => {
    if (editor) {
      editor.commands.setMeta("hideDragHandle", true);
    }
  }, [editor]);

  const onElementDragStart = useCallback(() => {
    if (!editor) return;
    editor.commands.setIsDragging(true);
  }, [editor]);

  const onElementDragEnd = useCallback(() => {
    if (!editor) return;
    editor.commands.setIsDragging(false);

    setTimeout(() => {
      editor.view.dom.blur();
      editor.view.focus();
    }, 0);
  }, [editor]);

  if (!editor) return null;

  const nodeName = labels.block;

  return (
    <div
      style={
        {
          "--drag-handle-main-axis-offset": `${mainAxisOffset}px`,
        } as React.CSSProperties
      }
    >
      <DragHandle
        editor={editor}
        onNodeChange={handleNodeChange}
        computePositionConfig={dynamicPositions}
        onElementDragStart={onElementDragStart}
        onElementDragEnd={onElementDragEnd}
        {...props}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            ...(isMobile || isTextSelectionValid(editor)
              ? { opacity: 0, pointerEvents: "none" }
              : {}),
            ...(isDragging ? { opacity: 0 } : {}),
          }}
        >
          {withSlashCommandTrigger && (
            <SlashCommandTriggerButton
              node={node}
              nodePos={nodePos}
              aria-label={labels.insertBlock}
              tooltip={labels.insertBlock}
              data-weight="small"
            />
          )}

          <Menu
            open={open}
            onOpenChange={setOpen}
            placement="left"
            trigger={
              <MenuButton
                render={
                  <Button
                    variant="ghost"
                    tabIndex={-1}
                    aria-label={labels.blockOptions}
                    tooltip={
                      <>
                        <div>{labels.clickForOptions}</div>
                        <div>{labels.holdForDrag}</div>
                      </>
                    }
                    data-weight="small"
                    style={{
                      cursor: "grab",
                      ...(open ? { pointerEvents: "none" } : {}),
                    }}
                    onMouseDown={() => selectNodeAndHideFloating(editor, nodePos)}
                  >
                    <GripVerticalIcon className="tiptap-button-icon" />
                  </Button>
                }
              />
            }
          >
            <MenuContent
              onClose={handleOnMenuClose}
              autoFocusOnHide={false}
              preventBodyScroll={true}
              portal
            >
              <Combobox style={SR_ONLY} />
              <ComboboxList style={{ minWidth: "15rem" }}>
                <MenuGroupLabel>{nodeName}</MenuGroupLabel>

                <MenuGroup>
                  <ColorMenu label={labels.color} />
                  <TableAlignMenu />
                  <TableFitToWidth labels={labels} />
                  <TransformActionGroup labels={labels} />
                </MenuGroup>

                <CoreActionGroup labels={labels} />

                <DeleteActionGroup labels={labels} />
              </ComboboxList>
            </MenuContent>
          </Menu>
        </div>
      </DragHandle>
    </div>
  );
};
