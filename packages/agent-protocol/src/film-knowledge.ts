import { z } from "zod";

export const FilmKnowledgeSourceSchema = z
  .object({
    documentId: z.string().uuid(),
    title: z.string().trim().min(1).max(240),
    snippet: z.string().trim().min(1).max(4000),
  })
  .strict();

export type FilmKnowledgeSource = z.infer<typeof FilmKnowledgeSourceSchema>;

export const FilmKnowledgeQueryRequestSchema = z
  .object({
    ipId: z.string().uuid(),
    ipTitle: z.string().trim().min(1).max(240),
    question: z.string().trim().min(1).max(1000),
    locale: z.enum(["en-US", "zh-CN", "zh-HK"]),
    sources: z.array(FilmKnowledgeSourceSchema).max(20),
  })
  .strict();

export type FilmKnowledgeQueryRequest = z.infer<typeof FilmKnowledgeQueryRequestSchema>;

export const FilmKnowledgeQueryResponseSchema = z
  .object({
    answer: z.string().trim().min(1).max(4000),
    citedDocumentIds: z.array(z.string().uuid()).max(20),
    unanswered: z.boolean().default(false),
  })
  .strict();

export type FilmKnowledgeQueryResponse = z.infer<typeof FilmKnowledgeQueryResponseSchema>;
