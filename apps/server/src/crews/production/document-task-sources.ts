import { z } from 'zod';
import { documentEpisodeSections } from './document-task-episodes';
import { PdfTaskSchema, groundedPdfTasks } from './pdf-task-schema';

// The model selects server-owned passages instead of retyping quotations.
export const ReferencedTasksSchema = z
  .object({
    tasks: z
      .array(
        PdfTaskSchema.omit({ evidence: true, episode: true })
          .extend({
            title: z.string().trim().min(1).max(120),
            sourceId: z.number().int().min(0),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

function splitPassages(source: string): string[] {
  const text = source.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (text.length < 8) throw new Error('Document source is too short.');
  const passages: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(offset + 800, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf(' ', end);
      if (boundary >= offset + 8) end = boundary;
    }
    const passage = text.slice(offset, end).trim();
    if (passage.length >= 8) passages.push(passage);
    else if (passage) {
      // Overlap the previous passage for a short final tail. Whitespace is
      // normalized above, as in groundedPdfTasks, so this stays bounded.
      passages.push(text.slice(Math.max(0, end - 16), end).trim());
    }
    offset = end;
    while (offset < text.length && /\s/.test(text[offset])) offset++;
  }
  return passages;
}

function sourceEntries(source: string) {
  return documentEpisodeSections(source).flatMap(({ text, episode }) =>
    text.trim().length < 8
      ? []
      : splitPassages(text).map((passage) => ({ passage, episode })),
  );
}
export function documentTaskSources(source: string): string[] {
  const entries = sourceEntries(source);
  if (!entries.length) throw new Error('Document source is too short.');
  return entries.map(({ passage }) => passage);
}

export function resolveDocumentTasks(
  value: unknown,
  source: string,
  passages: string[],
) {
  const parsed = ReferencedTasksSchema.parse(value);
  const entries = sourceEntries(source);
  return groundedPdfTasks(
    {
      tasks: parsed.tasks.map(({ sourceId, ...task }) => {
        const evidence = passages[sourceId];
        if (!evidence)
          throw new Error(
            'AI returned a task without a matching source excerpt. Analyze the document again.',
          );
        if (entries[sourceId]?.passage !== evidence)
          throw new Error('Document source references changed.');
        const episode =
          task.category === 'characters'
            ? undefined
            : entries[sourceId].episode;
        return {
          ...task,
          evidence,
          ...(episode
            ? { episode, title: `${episode.label}-${task.title}` }
            : {}),
        };
      }),
    },
    source,
  );
}
