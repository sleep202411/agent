export interface StoryBibleLine {
  speaker: string;
  text: string;
}

export interface StoryBibleSegment {
  key: string;
  title: string;
  durationMs: number;
  nextTargetKey: string | null;
  nextChoiceKey: string | null;
  trigger: string | null;
  visual: string;
  dialogue: StoryBibleLine[];
  choiceCard: string | null;
  endingCard: string | null;
}

const SEGMENT_HEADING =
  /^### ((?:S\d{2}[A-Z]?)|(?:E\d{2}))｜([^（\n]+)（(\d+) 秒）(?:→ ([CE]\d+))?$/gm;
const BOLD_LINE = /^\*\*([^*]+)\*\*：(.+)$/gm;

const NON_DIALOGUE_LABELS = new Set([
  '触发',
  '画面',
  '画面切黑',
  '选择字幕 C1',
  '选择字幕 C2',
  '选择字幕 C3',
  '选择字幕 C4',
  '选择字幕 C5',
  '选择字幕 C6',
  '尾声声音',
  '结局题签',
]);

export function parseStoryBibleSegments(markdown: string): StoryBibleSegment[] {
  const matches = [...markdown.matchAll(SEGMENT_HEADING)];
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? markdown.indexOf('\n## 7.', start);
    const body = markdown.slice(start, end === -1 ? undefined : end);
    const fields = [...body.matchAll(BOLD_LINE)].map((item) => ({
      label: item[1].trim(),
      value: item[2].trim().replace(/\s{2,}$/u, ''),
    }));

    const visualParts = fields
      .filter((field) => field.label === '画面' || field.label === '画面切黑')
      .map((field) => field.value);
    const dialogue = fields
      .filter((field) => !NON_DIALOGUE_LABELS.has(field.label))
      .map((field) => ({
        speaker: field.label,
        text: stripChineseQuotes(field.value),
      }));
    const trigger =
      fields.find((field) => field.label === '触发')?.value ?? null;
    const choiceCard =
      fields.find((field) => field.label.startsWith('选择字幕 '))?.value ??
      null;
    const endingCard =
      fields.find((field) => field.label === '结局题签')?.value ?? null;

    if (visualParts.length === 0) {
      throw new Error(`Story segment ${match[1]} has no visual direction.`);
    }

    const nextTargetKey = match[4] ?? null;
    return {
      key: match[1],
      title: match[2].trim(),
      durationMs: Number.parseInt(match[3], 10) * 1_000,
      nextTargetKey,
      nextChoiceKey: nextTargetKey?.startsWith('C') ? nextTargetKey : null,
      trigger,
      visual: visualParts.join(' '),
      dialogue,
      choiceCard,
      endingCard,
    };
  });
}

function stripChineseQuotes(value: string): string {
  if (value.startsWith('“') && value.endsWith('”')) {
    return value.slice(1, -1);
  }
  return value;
}
