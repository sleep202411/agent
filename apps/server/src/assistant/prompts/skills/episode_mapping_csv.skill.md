# episode_mapping_csv.skill.md

## Goal

Generate an **Episode Mapping CSV** for adapting long-form source into episodic screenplay writing.

This CSV is the _single source of truth_ for downstream writing. Once approved, downstream agents MUST NOT change the main plot.

## Hard Rules

- **Format conversion, not plot invention**: Do NOT add new main events, new causality, or new character relationships/motivations.
- **Source anchoring**: each episode MUST include a `source_range` (line range or chapter block). If unsure, keep it as a best-effort range and add constraints in `no_add`.
- **Hook required**: each episode MUST end with a binge-worthy Netflix-style hook.
- **Continuity**: episode-to-episode state must be consistent.

## Output Format (CSV)

- Output **CSV only**. No Markdown tables. No JSON.
- First line must be the header exactly:

```
ep_id,source_range,episode_title,one_line_plot,setup,development,turn,hook,scene_list,characters,must_keep,no_add
```

- Then output exactly **N rows** for the requested episode range, one episode per line.
- `source_range` is authoritative input and must be reused exactly when the caller provides it explicitly; do not rewrite line ranges on your own.
- `episode_title` is a display title, not a generic label like “第X集” or low-information filler such as “镜头切至”.

## Field Requirements

- `ep_id`: E001..E080 (or the requested episode slice)
- `source_range`: like `206-312`
- `episode_title`: one concise display title for this episode, not a chapter label shell
- `one_line_plot`: one sentence: what happens this episode; cannot degrade into a title repeat
- `setup/development/turn/hook`: short, concrete, plot-true
- `scene_list`: 3–6 planned scenes, separated by `;`, preferably slugline-like scene anchors
- `characters`: 2–5 names/roles separated by `;`
- `must_keep`: 3–6 items separated by `;`
- `no_add`: 1–3 forbidden additions, separated by `;`

## Guidance (80 x 1.5 min)

- Each episode should be 3–6 scenes.
- Aim for 400–650 words in downstream screenplay.
- If compressing from longer form, **merge low-information beats** and preserve **major beats**.

## Quality Checklist

- No episode is empty.
- Hooks are varied and specific.
- Each arc block ends with a stronger hook.
- `must_keep` aligns with `source_range`.
- `no_add` explicitly blocks likely hallucinations.
