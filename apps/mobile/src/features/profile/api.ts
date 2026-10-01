import { api } from "@/lib/api-client";
import type { AuthUser } from "@/auth/types";

export interface ProfileDraft {
  nickName: string;
  contact: string;
  description: string;
  other: string;
}
export function profileDraft(user: AuthUser): ProfileDraft {
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    nickName: text(user.nickName ?? user.nickname ?? user.userName ?? user.name),
    contact: text(user.contact),
    description: text(user.description),
    other: text(user.other),
  };
}
/** Same partial JSON update as Web; never send unrelated profile fields. */
export async function updateProfile(
  draft: ProfileDraft,
  study?: string,
  availableForWork?: boolean
) {
  if (!draft.nickName.trim()) throw new Error("Nickname is required");
  await api.post("/user/update/user/info", {
    service: "content",
    data: {
      ...(study !== undefined ? { study } : {}),
      ...(availableForWork !== undefined ? { availableForWork } : {}),
      nickName: draft.nickName.trim(),
      contact: draft.contact.trim(),
      description: draft.description.trim(),
      other: draft.other.trim(),
    },
  });
}
