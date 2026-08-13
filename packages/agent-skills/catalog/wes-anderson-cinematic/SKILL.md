---
name: wes-anderson-cinematic
description: >-
  Create image prompts, video prompts, storyboards, shot descriptions, and visual
  direction using a centered symmetrical storybook-cinema grammar associated
  with Wes Anderson: frontal tableaux, controlled lateral movement, restrained
  deadpan performance, tactile production design, and curated retro palettes.
  Use when the user explicitly requests Wes Anderson, symmetrical retro cinema,
  storybook theatrical staging, dollhouse composition, meticulously centered
  frames, or a related visual treatment for image generation, video generation,
  prompt writing, or Agent-assisted creative planning.
---

# Wes Anderson Cinematic

Translate the named reference into model-readable visual decisions. Do not stop at “in the style of Wes Anderson,” and do not depend on a generation provider understanding that phrase.

Treat this as an independent visual-grammar preset. Never claim affiliation with, endorsement by, or authorship from Wes Anderson.

<!-- fizzdragon:policy:prompt:start -->

Use frontal or perfectly lateral staging, rigorous symmetry, flat architectural layers, tactile handmade production design, restrained performances, curated limited palettes, and dry visual humor. Avoid generic teal-orange grading, handheld chaos, shallow-focus glamour, or copying a specific existing frame.

<!-- fizzdragon:policy:prompt:end -->

## Apply the Skill

1. Preserve the user's subject, product, story facts, identities, reference-image roles, required text, and delivery constraints.
2. Infer the intended medium: still image, moving image, storyboard/shot plan, or prompt-writing assistance.
3. Select one treatment unless the user requests alternatives:
   - **Live-action storybook** — believable people and locations with precise theatrical staging.
   - **Miniature theatre** — tactile dollhouse, stop-motion, clay, paper, or handcrafted materials.
   - **Retro editorial** — clean commercial, travel-poster, fashion, food, or product imagery.
4. Build the result from concrete choices for composition, camera, palette, production design, lighting, performance, and motion.
5. Resolve conflicts using this priority order:
   - explicit user constraints;
   - approved project references and continuity facts;
   - product identity and exact copy;
   - this skill's visual grammar;
   - decorative flourishes.
6. Compile the provider-facing prompt from descriptive attributes. Omit the director's name unless the user explicitly needs it retained in visible explanatory text.
7. Return the requested artifact, not a lecture about the style.

Read [visual grammar](references/visual-grammar.md) whenever constructing or evaluating the creative direction. Read [prompt templates](references/prompt-templates.md) when producing generation-ready image or video prompts.

## Preserve the Creative Intent

- Keep the user's central subject and narrative action unmistakable.
- Use symmetry to clarify hierarchy, not to fill every frame with arbitrary decoration.
- Break symmetry only for a deliberate narrative turn, imbalance, surprise, or reveal.
- Prefer a small, coherent palette over a list of fashionable color words.
- Keep props period-aware and story-relevant. Avoid random “quirky” clutter.
- Preserve exact brand names, packaging, signage, and supplied copy. Warn briefly when a selected image model may render exact text unreliably.
- Preserve faces, products, costumes, and locations from approved references. Do not let the treatment replace their identity.

## Still-Image Behavior

<!-- fizzdragon:policy:image:start -->

Compose as a centered storybook tableau with exact geometry, frontal eye-level camera, layered practical set dressing, soft even light, restrained expressions, a limited harmonious palette, and small narrative props. Keep the result original rather than recreating an identifiable film still.

<!-- fizzdragon:policy:image:end -->

Build a single legible moment with:

- one dominant centered subject or balanced ensemble;
- frontal or orthographic-feeling camera placement;
- architectural, shelving, doorway, window, or furniture geometry acting as a frame;
- a restrained palette with one controlled accent;
- tactile, designed surfaces and era-consistent props;
- even, theatrical, readable light;
- precise poses and understated expressions;
- enough depth layering to avoid a flat poster unless a poster is requested.

Do not automatically turn the scene into clay or a miniature. Use the miniature treatment only when requested or when it materially improves the concept.

## Video Behavior

<!-- fizzdragon:policy:video:start -->

Stage action in a locked frontal tableau or a precise lateral track. Use deliberate entrances, exits, whip-pans only as motivated punctuation, clean blocking, restrained acting, tactile practical environments, and a stable composed end frame.

<!-- fizzdragon:policy:video:end -->

Write shots as reproducible temporal instructions, not as a stack of adjectives.

- Establish a clean symmetrical tableau before introducing movement.
- Prefer locked-off frames, centered push-ins, exact lateral tracks, overhead inserts, whip-pan transitions, match cuts, and discrete blocking beats.
- State start frame, action beats, camera movement, end frame, and continuity locks.
- Keep screen direction, wardrobe, prop positions, subject identity, and palette stable across shots.
- Use restrained acting: contained reactions, precise gestures, ensemble blocking, and purposeful pauses.
- Reserve camera shake, handheld drift, fast orbiting, shallow-focus glamour, and chaotic montage for explicit user requests.
- Give each shot one principal camera move. Do not combine dolly, crane, orbit, zoom, and handheld movement in the same short shot.

## Prompt-Writing and Agent Behavior

When helping an agent write or revise prompts:

- Translate vague requests into observable visual and temporal constraints.
- Offer at most one necessary assumption when the prompt lacks a critical story fact; otherwise proceed.
- Keep the raw user prompt intact in product history. Produce the skill-enhanced prompt as a separate compiled result.
- Do not invent project assets, reference approvals, character facts, brand claims, or generation results.
- Apply the skill only to creative-direction fields. Do not let it override permissions, project policy, safety rules, model capability, or tool contracts.
- If a request is purely analytical, explain which visual decisions create the effect instead of generating a prompt automatically.

## Compose with Model Skills

Keep this skill responsible for creative direction. Let a separate model-capability skill handle provider details such as endpoint selection, supported sizes, quality tiers, reference-image limits, masks, output format, and cost.

Apply them in this order:

1. Resolve user intent, project references, and this skill's visual locks.
2. Produce the model-independent compiled prompt.
3. Let the selected model skill adapt syntax and parameters without weakening identity, continuity, exact-copy, or visual-direction locks.
4. Submit through FizzDragon's managed generation service.

Do not execute a third-party CLI, read a user API key, or bypass the managed generation service merely because a model skill includes its own execution script.

## Avoid Imitation and Drift

Do not recreate a recognizable shot, set, costume, character, poster, title card, or scene from a specific film. Do not request a specific actor's likeness or introduce protected logos and characters that the user did not provide.

Avoid these generic failure modes:

- a prompt that contains only the director's name and “cinematic”;
- perfect symmetry with no narrative focal point;
- orange-and-teal blockbuster grading;
- neon cyberpunk, glossy sci-fi, or luxury-commercial surfaces by default;
- excessive bokeh, anamorphic flares, fog, grain, or vignette;
- random vintage props with inconsistent decades;
- forced whimsy, exaggerated comedy faces, or caricature;
- illegible decorative typography;
- clay, stop-motion, or dollhouse materials applied to every request;
- copying named films as shortcuts.

## Quality Check

Before returning the result, confirm:

- the subject and requested action remain clear;
- the composition has an intentional center and visual hierarchy;
- palette, surfaces, props, and era agree;
- camera and motion instructions are physically coherent;
- video prompts define start, action, and end states;
- continuity facts and references are preserved;
- the provider-facing prompt works without relying on the director's name;
- no specific film scene or protected character has been reproduced.
