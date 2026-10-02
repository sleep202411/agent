# Experience Player React

Production React host for `@repo/experience-engine`. It is the single player
implementation used by both the private Studio playtest and the public Web
player.

## Boundary

- `@repo/experience-engine` remains deterministic and headless.
- This package owns browser media, Web Audio, theme integrity loading,
  responsive orientation, spatial gestures, and core renderer UI.
- Host apps inject localized copy and may inject a custom theme loader. The
  package does not import Next.js, an app alias, or an app i18n runtime.
- Host apps own data access and authorization. The player only accepts a
  Runtime Manifest and never knows whether it came from a private draft,
  frozen build, or published CDN release.

Tailwind v4 host stylesheets must register `src/` with `@source`; both Web and
Studio do this in their global stylesheet.

## Media delivery

A manifest names one progressive file per clip; a frozen build clip is a
`/story-projects/…/builds/…/assets/…/variants/…/content` URI.

- **Adaptive playback (`adaptivePlayback`)** — off by default. When a host turns
  it on, the player asks the sibling `/playback` endpoint of each build clip
  whether a ready HLS master stands in for it, and plays that master instead.
  `null` keeps the declared file. A refused or malformed answer is shown to the
  viewer verbatim; nothing silently falls back to `/content`. Only enable it
  where the server transcodes: Web on the cn cell (`adaptiveStoryPlayback`).
  Studio leaves it off.
- **hls.js is bundled.** It is loaded with a dynamic `import("hls.js")`, never
  from Vidstack's jsDelivr default, so the cn cell has no third-party CDN
  dependency. On Apple WebKit an HLS master goes to the native element instead.
- **Prefetch.** Before Start only the entry clip buffers, on its own element
  (`preload="auto"`); Start waits until it is on an element. After Start the
  look-ahead warms one clip opening at a time: the rest of the current scene,
  then the first clip of each scene one `scene.goto` away that the viewer can
  access. An HLS warm fetches one rendition's first segment (and pins hls.js to
  start on that rendition); native HLS only negotiates; a progressive warm
  preloads on a detached element until it can play through.

## Playback state

The viewer's pause is a state of its own — `user`, `hidden` or `refused` —
combined with the gates the story already has (access, the locked-scene gate,
the timeline-control charge), never worked out from them.

- **Holds.** One rule (`resolveExperiencePlaybackHolds`) decides what holds
  story time, Web Audio and the clips, at render and between renders alike. A
  pause or an access flow holds all three; a charge holds only its clip, since
  its idle timeout is story time; the ending leaves Web Audio to its cues.
- **Story time.** Everything that moves the story without media — the fixed
  scene clock, stills, held frames, placeholders, the charge idle timeout,
  press-hold frames — runs on `ExperienceStoryClock`, never on `window`, so one
  pause freezes it all. Video time stops with its element.
- **One play path.** Every play the player starts goes through `playHandle`
  and one classifier (`resolveExperiencePlaybackRejection`). A `NotAllowedError`
  that outlives the muted retry — WebKit plays an element only once a tap played
  it, and Low Power Mode refuses every other play — pauses the story as
  `refused`, for one tap; so does one from Web Audio, from a world stream, or
  from a play Vidstack starts itself. Only a real failure shows the dialog.
- **Pauses from outside.** A clip the system or the OS controls stop while it
  plays pauses the story with it; a play the player did not ask for is stopped
  again. A press or swipe in progress is dropped without a verdict, and a
  renderer outcome that lands during a pause waits for the resume.

## Landscape films on phones

A cinematic landscape film is presented in landscape on a phone, decided by the
device (`isPhoneDevice`), never by the window size: tablets and desktops
letterbox. Start asks for fullscreen and a landscape orientation lock; where the
browser refuses (Safari on iPhone, many in-app browsers) the film frame is drawn
sideways while the phone is upright. Everything that belongs to the picture —
media, spatial cues, choices — sits in that frame and turns with it, and choice
UI is sized with container-query units against the frame. The player gives the
screen back at the ending, before a host access dialog, and on unmount.
