# Courses

Public catalog and detail under `/courses` and `/courses/[id]`.

## Backend APIs

Java Content (proxied via `JAVA_CONTENT_URL`):

| Call     | Path                                             |
| -------- | ------------------------------------------------ |
| List     | `GET /project/courses`                           |
| Detail   | `GET /project/courses/{id}`                      |
| Play URL | `GET /project/courses/videos/{videoId}/play-url` |

Client: [`src/services/courses-public.ts`](../../src/services/courses-public.ts), hooks in [`src/hooks/use-courses-public.ts`](../../src/hooks/use-courses-public.ts).

Legacy list/play helpers remain in `src/services/courses.ts` / `use-courses.ts` for episode progress storage used by `CourseVideoPlayer`.

## Layout

```
courses/
├─ page.tsx                 ← catalog: required / skill / master
├─ [id]/page.tsx            ← detail + player
└─ _components/
   ├─ CoursesHero.tsx
   ├─ PublicCourseList.tsx
   ├─ PublicCourseCard.tsx
   ├─ PublicCourseDetailPanel.tsx
   └─ CourseVideoPlayer.tsx
```

List items include `type` (`1` required, `2` master, `3` skill). Missing `type` is treated as master class so the catalog still renders before Java ships the column.

Default locale `zh-CN` has no URL prefix (`/courses`); other locales are
prefixed (`/en-US/courses`).
