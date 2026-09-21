import type { ModerationDetail } from "./content-review-api";

const MAX_REVIEW_SECONDS = 3 * 60 * 60;

export type ReviewFindingSource = "frame" | "audio" | "comment" | "other";

export type ReviewFinding = {
  id: string;
  seconds: number | null;
  source: ReviewFindingSource;
  label: string;
  description: string;
  confidence: number | null;
  frameUrl: string | null;
  audioText: string | null;
  createdByUserId: string | null;
};

export function parseReviewTimeOffset(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return normalizeSeconds(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const msSuffix = /^(-?\d+(?:\.\d+)?)\s*ms$/i.exec(trimmed);
  if (msSuffix) return normalizeSeconds(Number(msSuffix[1]) / 1000);

  const secSuffix = /^(-?\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?$/i.exec(trimmed);
  if (secSuffix) return normalizeSeconds(Number(secSuffix[1]));

  if (/^\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(trimmed)) {
    const parts = trimmed.split(":").map(Number);
    if (parts.some((part) => !Number.isFinite(part))) return null;
    if (parts.length === 3) {
      return normalizeSeconds(parts[0] * 3600 + parts[1] * 60 + parts[2]);
    }
    return normalizeSeconds(parts[0] * 60 + parts[1]);
  }

  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? normalizeSeconds(numeric) : null;
}

export function formatReviewTimecode(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const clock = `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  return hours > 0 ? `${String(hours).padStart(2, "0")}:${clock}` : clock;
}

export function classifyReviewSource(source: string | null | undefined): ReviewFindingSource {
  const value = source?.trim().toLowerCase() ?? "";
  if (/audio|voice|speech|asr|sound/.test(value)) return "audio";
  if (/frame|image|video|visual|ocr|picture/.test(value)) return "frame";
  return "other";
}

export function reviewFindingsFromDetails(details: ModerationDetail[]): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  details.forEach((detail, index) => {
    const label = detail.label?.trim() ?? "";
    const description = detail.description?.trim() ?? "";
    const audioText = detail.audioText?.trim() || null;
    const frameUrl = detail.frameTempUrl?.trim() || null;
    if (!label && !description && !audioText && !frameUrl) return;
    findings.push({
      id: `finding-${index}`,
      seconds: parseReviewTimeOffset(detail.timeOffset),
      source: classifyReviewSource(detail.source),
      label,
      description,
      confidence:
        typeof detail.confidence === "number" && Number.isFinite(detail.confidence)
          ? detail.confidence
          : null,
      frameUrl,
      audioText,
      createdByUserId: null,
    });
  });
  return findings.sort(compareFindings);
}

export function reviewFindingsFromComments(
  comments: Array<{
    id: string;
    seconds: number;
    body: string;
    createdByUserId: string;
  }>
): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const comment of comments) {
    const description = comment.body.trim();
    const seconds = normalizeSeconds(comment.seconds);
    if (!description || seconds == null) continue;
    findings.push({
      id: comment.id,
      seconds,
      source: "comment",
      label: "",
      description,
      confidence: null,
      frameUrl: null,
      audioText: null,
      createdByUserId: comment.createdByUserId,
    });
  }
  return findings.sort(compareFindings);
}

export function mergeReviewFindings(
  findings: ReviewFinding[],
  comments: ReviewFinding[]
): ReviewFinding[] {
  return [...findings, ...comments].sort(compareFindings);
}

export type ReviewFindingGroup = {
  key: string;
  seconds: number | null;
  detections: ReviewFinding[];
  comments: ReviewFinding[];
};

export function groupReviewFindings(findings: ReviewFinding[]): ReviewFindingGroup[] {
  const groups: ReviewFindingGroup[] = [];
  const byKey = new Map<string, ReviewFindingGroup>();
  for (const finding of findings) {
    const key = finding.seconds == null ? "untimed" : String(Math.floor(finding.seconds));
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        seconds: finding.seconds == null ? null : Math.floor(finding.seconds),
        detections: [],
        comments: [],
      };
      byKey.set(key, group);
      groups.push(group);
    }
    if (finding.source === "comment") group.comments.push(finding);
    else group.detections.push(finding);
  }
  return groups;
}

function compareFindings(a: ReviewFinding, b: ReviewFinding): number {
  if (a.seconds == null && b.seconds == null) return a.id.localeCompare(b.id);
  if (a.seconds == null) return 1;
  if (b.seconds == null) return -1;
  if (a.seconds !== b.seconds) return a.seconds - b.seconds;
  return a.id.localeCompare(b.id);
}

export function findingsNearTime(
  findings: ReviewFinding[],
  currentSeconds: number,
  windowSeconds = 0.75
): ReviewFinding[] {
  return findings.filter((finding) => {
    if (finding.seconds == null) return false;
    return Math.abs(finding.seconds - currentSeconds) <= windowSeconds;
  });
}

function normalizeSeconds(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const seconds = value > MAX_REVIEW_SECONDS ? value / 1000 : value;
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_REVIEW_SECONDS) return null;
  return seconds;
}
