# Prompt Templates

Use these as assembly orders, not as mandatory prose. Remove headings when the target generation provider performs better with a single paragraph.

## Image Prompt Assembly

1. **Subject and action** — identify the exact subject, product, character, and frozen moment.
2. **Treatment** — choose live-action storybook, miniature theatre, or retro editorial.
3. **Composition** — state centerline, symmetry type, framing geometry, depth bands, and focal hierarchy.
4. **Camera** — specify shot size, height, angle, lens feel, perspective, and focus depth.
5. **Production design** — define set, materials, relevant props, costume, and era.
6. **Palette** — name a restricted palette and one accent.
7. **Lighting and finish** — define direction, softness, contrast, texture, and output finish.
8. **Identity and text locks** — preserve supplied references, product geometry, labels, and exact copy.
9. **Exclusions** — list only failure modes relevant to the request.

### Image Skeleton

```text
[SUBJECT] [ACTION] in a [TREATMENT] scene. [SHOT SIZE], frontal eye-level camera,
[LENS FEEL], [SYMMETRY AND ARCHITECTURAL FRAME], [DEPTH STRUCTURE].
[SET, MATERIALS, PROPS, COSTUME, ERA]. Restricted palette of [COLORS] with
[ACCENT]. [LIGHTING], moderate contrast, matte tactile surfaces, readable detail.
Preserve [REFERENCE/IDENTITY/PRODUCT/TEXT LOCKS]. Avoid [RELEVANT EXCLUSIONS].
```

### Image Example

```text
A young railway concierge places a brass room key on the counter and looks
straight into camera, live-action storybook treatment. Centered medium-wide
tableau, frontal eye-level camera, natural 40 mm perspective, bilateral lobby
architecture framing the subject, counter in the foreground and key cabinet in
the background, moderate deep focus. Painted warm-cream woodwork, burgundy wool
uniform, numbered brass hooks, one small vase of carnations, coherent late-1960s
hotel details. Restricted warm cream, powder pink and oxblood palette with a
mustard key tag accent. Soft frontal daylight with warm practical fill, moderate
contrast, matte tactile finish. Keep facial identity and uniform details stable.
Avoid exaggerated comedy, glossy luxury styling, orange-teal grading, heavy
bokeh, distorted architecture, and illegible signage.
```

## Video Prompt Assembly

1. **Continuity lock** — define identities, wardrobe, environment, palette, props, aspect ratio, and duration.
2. **Start frame** — specify the stable opening composition.
3. **Action beats** — describe two to four discrete, time-ordered actions.
4. **Camera movement** — use one principal movement with direction and speed.
5. **End frame** — state the final composition and subject state.
6. **Performance** — define restrained gesture, gaze, and timing.
7. **Lighting and material stability** — prevent flicker and set drift.
8. **Negative motion constraints** — block unwanted shake, orbit, zoom, morphing, and continuity failures.

### Video Skeleton

```text
[DURATION, ASPECT, CONTINUITY LOCKS]. Start on [SYMMETRICAL OPENING TABLEAU].
Beat 1: [ACTION]. Beat 2: [ACTION]. Beat 3: [OPTIONAL ACTION]. The camera
[ONE MOVE, DIRECTION, SPEED] and ends on [PRECISE END FRAME]. Performance is
[GESTURE, GAZE, EMOTIONAL RESTRAINT]. [LIGHTING AND MATERIALS] remain stable.
No [UNWANTED CAMERA MOTION, MORPHING, IDENTITY DRIFT, PROP DRIFT, TEXT DRIFT].
```

### Video Example

```text
Six seconds, 16:9. Preserve the same concierge, burgundy uniform, brass key,
hotel counter, warm-cream lobby, and powder-pink/oxblood palette throughout.
Start on a locked, centered medium-wide frontal tableau with the concierge behind
the counter and the numbered key cabinet aligned on the center axis. Beat 1: he
slides one brass key forward with his right hand. Beat 2: he pauses, lifts his
eyes directly to camera, and raises one eyebrow slightly. Beat 3: a bellhop crosses
the far background from left to right. The camera performs one slow centered
push-in at constant speed and ends on a symmetrical medium close-up with the key
still visible at the bottom of frame. Understated deadpan performance; no smile.
Soft frontal daylight and warm practical fill remain stable; matte surfaces and
straight architectural lines. No handheld shake, orbit, dutch angle, focus
pumping, face change, costume change, extra fingers, prop teleportation, or text
mutation.
```

## Storyboard or Shot-Plan Output

For each shot, provide only the fields the product or user needs. Prefer this order:

```text
Shot purpose
Framing and composition
Subject blocking and action beats
Camera movement
Production design and palette
Lighting
Continuity locks
Generation prompt
```

Use the visual grammar to differentiate shots. Do not produce a sequence of nearly identical centered frames; alternate purposeful tableaux, lateral reveals, overhead inserts, and centered reactions while maintaining the same world.

## Prompt Revision

When revising an existing prompt:

1. Extract immutable facts and references.
2. Identify missing visual decisions.
3. Add only the decisions required for a coherent result.
4. Remove duplicated adjectives and conflicting camera instructions.
5. Keep the user's original prompt available separately from the compiled prompt.
6. Explain material changes in one short sentence only when the user asks for rationale.
