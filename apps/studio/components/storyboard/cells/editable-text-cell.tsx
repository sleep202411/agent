"use client";

import { RichMentionEditor } from "../editor/rich-mention-editor";
import type { MentionItem, MentionType } from "../editor/mention-node";

interface EditableTextCellProps {
  value: string;
  editing: boolean;
  onSave: (value: string) => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
  placeholder?: string;
  mentionItems: MentionItem[];
  allowedMentionTypes?: MentionType[];
  showAvatar?: boolean;
  extraFields?: Array<"voiceId" | "model">;
}

export function EditableTextCell(props: EditableTextCellProps) {
  return (
    <RichMentionEditor
      value={props.value}
      editing={props.editing}
      onChange={props.onSave}
      onStartEdit={props.onStartEdit}
      onStopEdit={props.onStopEdit}
      placeholder={props.placeholder}
      mentionItems={props.mentionItems}
      mentionTypes={props.allowedMentionTypes}
      showAvatar={props.showAvatar}
      extraFields={props.extraFields}
    />
  );
}
