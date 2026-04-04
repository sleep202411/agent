import { backendApi, type Paginated } from "@/src/lib/api";
import type { Asset, ShotValue } from "@/src/store/slices/projectSlice";

const ROLE_PAGE_SIZE = 100;
const ROLE_MAX_PAGE_COUNT = 20;
const SPEAKER_LABEL_RE = /^(?:台词|对白|旁白)\s*[：:]\s*/;
const DIALOGUE_LABEL_RE = /^(?:台词|对白)\s*[：:]\s*/;
const NARRATION_LABEL_RE = /^旁白\s*[：:]\s*/;
const ROLE_LINE_RE = /^角色\s*[：:]\s*/;
const AT_PREFIX_RE = /(^|[\s\n])@(?=\S)/g;

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\r\n?/g, "\n");
}

export function stripDialogueMarkup(value: unknown) {
  return normalizeText(value)
    .replace(/<mention\s+[^>]*>([\s\S]*?)<\/mention>/gi, "$1")
    .replace(/<(?!br\s*\/?)[^>]+>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(AT_PREFIX_RE, "$1")
    .trim();
}

function normalizeDialoguePlainText(value: unknown) {
  return stripDialogueMarkup(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function uniqueNames(values: unknown[] = []) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function splitRoleNames(value: unknown) {
  return uniqueNames(
    String(value ?? "")
      .split(/[、,，/]/)
      .map((item) => item.trim())
  );
}

function parseSpeakerPrefix(value: unknown) {
  const match = String(value ?? "")
    .trim()
    .match(/^([^：:\n]{1,40})\s*[：:]\s*([\s\S]*)$/);
  if (!match?.[1]) return null;
  return {
    speaker: match[1].trim(),
    content: String(match[2] ?? "").trim(),
  };
}

function stripSpeakerPrefix(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const parsed = parseSpeakerPrefix(text);
  return parsed?.content || text;
}

function parseDialogueSections(value: unknown) {
  const lines = normalizeDialoguePlainText(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const roleNames: string[] = [];
  const dialogueLines: string[] = [];
  const narrationLines: string[] = [];

  lines.forEach((line) => {
    if (ROLE_LINE_RE.test(line)) {
      roleNames.push(...splitRoleNames(line.replace(ROLE_LINE_RE, "").trim()));
      return;
    }

    if (DIALOGUE_LABEL_RE.test(line)) {
      dialogueLines.push(line.replace(DIALOGUE_LABEL_RE, "").trim());
      return;
    }

    if (NARRATION_LABEL_RE.test(line)) {
      narrationLines.push(line.replace(NARRATION_LABEL_RE, "").trim());
      return;
    }

    dialogueLines.push(line.replace(SPEAKER_LABEL_RE, "").trim());
  });

  return {
    roleNames: uniqueNames(roleNames),
    dialogueLines: dialogueLines.filter(Boolean),
    narrationLines: narrationLines.filter(Boolean),
  };
}

export function stripDialogueRoleLines(value: unknown) {
  const { dialogueLines, narrationLines } = parseDialogueSections(value);
  const normalizedLines: string[] = [];

  dialogueLines.forEach((line) => {
    const content = stripSpeakerPrefix(line);
    if (content) {
      normalizedLines.push(`台词：${content}`);
    }
  });

  narrationLines.forEach((line) => {
    if (line) {
      normalizedLines.push(`旁白：${line}`);
    }
  });

  return normalizedLines.join("\n");
}

function extractSpeakerNameFromDialogue(value: unknown) {
  const { roleNames, dialogueLines } = parseDialogueSections(value);

  for (const line of dialogueLines) {
    const normalizedLine = line.replace(SPEAKER_LABEL_RE, "").trim();
    const parsed = parseSpeakerPrefix(normalizedLine);
    if (parsed?.speaker) {
      return parsed.speaker;
    }
  }

  return roleNames[0] || "";
}

function findDialogueCell(shotValues: ShotValue[] = []) {
  return shotValues.find((cell) => cell?.presetColumnKey === "dialogue");
}

function findCharacterCell(shotValues: ShotValue[] = []) {
  return shotValues.find((cell) => cell?.presetColumnKey === "character");
}

function extractCellEntityIds(cell?: ShotValue) {
  if (!cell) return [];
  if (Array.isArray(cell.characters) && cell.characters.length > 0) {
    return cell.characters
      .map((item) =>
        String(
          (item as { id?: string; value?: string })?.id ??
            (item as { value?: string })?.value ??
            item ??
            ""
        ).trim()
      )
      .filter(Boolean);
  }
  if (Array.isArray(cell.values) && cell.values.length > 0) {
    return cell.values
      .map((item) =>
        String(
          (item as { id?: string; value?: string })?.id ??
            (item as { value?: string })?.value ??
            item ??
            ""
        ).trim()
      )
      .filter(Boolean);
  }
  return [];
}

function buildRoleLookup(roles: Asset[] = []) {
  const byId = new Map<string, Asset>();
  const byName = new Map<string, Asset>();

  roles.forEach((role) => {
    const id = String(role?.id ?? "").trim();
    const name = String(role?.name ?? "").trim();
    if (id && !byId.has(id)) {
      byId.set(id, role);
    }
    if (name && !byName.has(name)) {
      byName.set(name, role);
    }
  });

  return { byId, byName };
}

function getRoleImagePath(role?: Asset) {
  const roleImgPath = Array.isArray(role?.roleImgPath)
    ? role.roleImgPath.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
  if (roleImgPath[0]) return roleImgPath[0];

  if (role?.otherImgPath && typeof role.otherImgPath === "object") {
    const first = Object.values(role.otherImgPath)
      .map((item) => String(item ?? "").trim())
      .find(Boolean);
    if (first) return first;
  }

  if (typeof role?.otherImgPath === "string" && role.otherImgPath.trim()) {
    return role.otherImgPath.trim();
  }

  return "";
}

export async function listAllWorldRoles(worldId: string) {
  if (!worldId) return [];

  const roles: Asset[] = [];
  for (let page = 1; page <= ROLE_MAX_PAGE_COUNT; page += 1) {
    const response = await backendApi.post<Paginated<Asset>>("/api/user/world/list/worldrole", {
      data: { worldId, page, pageSize: ROLE_PAGE_SIZE },
    });
    const list = Array.isArray(response?.list) ? response.list : [];
    roles.push(...list);
    if (list.length < ROLE_PAGE_SIZE) {
      break;
    }
  }

  return roles;
}

function getDialogueRawTextFromShotValues(shotValues: ShotValue[] = []) {
  const dialogueCell = findDialogueCell(shotValues);
  if (!dialogueCell) return "";
  return normalizeDialoguePlainText(dialogueCell.richText?.content || dialogueCell.value || "");
}

export function getDialogueTextFromShotValues(shotValues: ShotValue[] = []) {
  return stripDialogueRoleLines(getDialogueRawTextFromShotValues(shotValues));
}

export async function resolveDialogueVoicePreset({
  shotValues = [],
  worldId = "",
}: {
  shotValues?: ShotValue[];
  worldId?: string;
} = {}) {
  if (!worldId) {
    return { voiceId: "", model: "", speakerName: "", referenceFacePath: "" };
  }

  const roles = await listAllWorldRoles(worldId);
  const { byId, byName } = buildRoleLookup(roles);
  const rawDialogueText = getDialogueRawTextFromShotValues(shotValues);
  const speakerName = extractSpeakerNameFromDialogue(rawDialogueText);

  if (speakerName) {
    const speakerRole = byName.get(speakerName);
    if (speakerRole?.voiceId || speakerRole?.model) {
      return {
        voiceId: String(speakerRole.voiceId ?? "").trim(),
        model: String(speakerRole.model ?? "").trim(),
        speakerName,
        referenceFacePath: getRoleImagePath(speakerRole),
      };
    }
  }

  const characterCell = findCharacterCell(shotValues);
  const characterIds = Array.from(new Set(extractCellEntityIds(characterCell)));
  if (characterIds.length === 1) {
    const role = byId.get(characterIds[0]);
    if (role?.voiceId || role?.model) {
      return {
        voiceId: String(role.voiceId ?? "").trim(),
        model: String(role.model ?? "").trim(),
        speakerName: speakerName || String(role.name ?? "").trim(),
        referenceFacePath: getRoleImagePath(role),
      };
    }
  }

  return { voiceId: "", model: "", speakerName, referenceFacePath: "" };
}
