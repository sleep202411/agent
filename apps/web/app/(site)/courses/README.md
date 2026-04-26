# Courses Migration Notes

Port of the `/course` and `/courseDetail` pages from the legacy
`fizzdragon-web` (uni-app + Vue 2) repo into the Next.js App Router.

## Legacy source

| Legacy path                                     | New route       |
| ----------------------------------------------- | --------------- |
| `pages/course/course.vue`                       | `/courses`      |
| `pages/courseDetail/courseDetail.vue?id=&type=` | `/courses/[id]` |

The legacy detail URL also accepts a `type` query (`0` = AIGC master class,
`1` = platform tutorial) — keep it as a search param on the new route.

## Backend APIs

Both endpoints sit on the Java Content backend. They are already proxied
through `next.config.ts` (`/project/* → JAVA_CONTENT_URL/project/*`), so
call them with the existing `backendApi` helper from `@/src/lib/api` —
no new fetch wrapper required.

### 1. List courses

```
GET  /project/list/course/type/title
```

Source: `fizzdragon-web/src/services/squareService.js` → `getCourseListData()`.

Response shape (legacy comment):

```jsonc
{
  "code": 200,
  "data": {
    "0": [
      /* FizzDragon AIGC master-class courses */
    ],
    "1": [
      /* FizzDragon platform tutorials */
    ],
  },
}
```

Each course item observed in legacy code:

| Field         | Notes                                                  |
| ------------- | ------------------------------------------------------ |
| `id`          | Course id, used for detail navigation                  |
| `type`        | Sub-category label inside a section, used for grouping |
| `number`      | Sort order within a `type` group                       |
| `picLink`     | Cover image, prefix with `IMG_BASE_URL`                |
| `title`       | Display title                                          |
| `firstCourse` | Used by list page to surface a section's lead course   |

### 2. Get course video URL

```
POST /project/play/course/getLink
Content-Type: application/x-www-form-urlencoded
body: id=<courseId>
```

Source: `fizzdragon-web/src/services/squareService.js` → `getCourseVideoLink({ id })`.

Response:

```jsonc
{ "code": 200, "data": "<signed-video-url>" }
// 403 means the user does not have access — show an upgrade prompt.
```

## Planned file layout

```
courses/
├─ README.md            ← this file
├─ page.tsx             ← list page (sections from `data[0]` and `data[1]`)
├─ _components/         ← course-page-only UI bits (cards, sidebar, player)
└─ [id]/
   └─ page.tsx          ← detail page (video player + sibling-course list)
```

## Conventions reminder

- Default to English UI strings; add new copy under a `courses` namespace
  in `apps/web/messages/{en-US,zh-CN,zh-HK}.json`. Don't introduce new
  Chinese string literals in code.
- Site chrome (`GlobalNav`, `SiteFooter`) comes from `app/(site)/layout.tsx`,
  so the page files only render their own content.
- Default locale `zh-CN` has no URL prefix (`/courses`); other locales are
  prefixed (`/en-US/courses`). `proxy.ts` strips the prefix internally —
  no per-page locale handling needed.
