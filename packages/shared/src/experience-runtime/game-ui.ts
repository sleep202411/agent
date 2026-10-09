import { z } from "zod";

/** Source data, never a host filesystem path or executable build configuration. */
export const GameUISourceSchema = z
  .object({
    apiVersion: z.literal(1),
    surface: z.literal("main-menu"),
    entry: z.string().max(120),
    files: z
      .array(
        z
          .object({
            path: z
              .string()
              .regex(/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:js|ts|css|json|svg)$/)
              .max(120),
            content: z.string().max(64 * 1024),
          })
          .strict()
      )
      .min(1)
      .max(24),
  })
  .strict()
  .superRefine((source, ctx) => {
    const paths = source.files.map((file) => file.path);
    if (new Set(paths).size !== paths.length)
      ctx.addIssue({ code: "custom", message: "Source file paths must be unique." });
    if (!paths.includes(source.entry) || !/\.(js|ts)$/.test(source.entry))
      ctx.addIssue({
        code: "custom",
        message: "The entry must name a JavaScript or TypeScript source file.",
      });
    if (
      source.files.reduce((size, file) => size + new TextEncoder().encode(file.content).length, 0) >
      256 * 1024
    )
      ctx.addIssue({ code: "custom", message: "Game UI source exceeds 256 KiB." });
  });
export type GameUISource = z.infer<typeof GameUISourceSchema>;

export const GameUIArtifactSchema = z
  .object({
    apiVersion: z.literal(1),
    surface: z.literal("main-menu"),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    artifactHash: z.string().regex(/^[a-f0-9]{64}$/),
    toolchain: z.string().min(1).max(100),
    javascript: z
      .string()
      .min(1)
      .max(512 * 1024),
    css: z.string().max(256 * 1024),
  })
  .strict()
  .refine(
    (artifact) => new TextEncoder().encode(artifact.javascript + artifact.css).length <= 768 * 1024,
    "Game UI artifact exceeds 768 KiB."
  );
export type GameUIArtifact = z.infer<typeof GameUIArtifactSchema>;

export const GameUIProjectSchema = z
  .object({
    source: GameUISourceSchema,
    artifact: GameUIArtifactSchema,
  })
  .strict();
export type GameUIProject = z.infer<typeof GameUIProjectSchema>;

/** The code surface is explicitly separate from safe appearance CSS/SVG. */
export const GAME_UI_CONTRACT = {
  apiVersion: 1,
  surface: "main-menu",
  entryExport: "mount({ root, game, context }) => cleanup | Promise<cleanup>",
  files:
    "JavaScript/TypeScript, CSS, JSON, SVG; exact relative imports only; no packages, remote imports or build scripts.",
  context: [
    "title",
    "summary",
    "eyebrow",
    "coverUrl",
    "copy.start",
    "copy.starting",
    "copy.loading",
    "copy.continue",
    "copy.restart",
    "copy.map",
  ],
  game: {
    methods: [
      "getSnapshot()",
      "subscribe(listener) => unsubscribe",
      "invoke(action) => Promise<{ok, reason?}>",
    ],
    actions: ["start", "continue", "restart", "open-map", "close-map", "return-menu"],
    snapshot: ["screen", "started", "status", "mapOpen", "actions"],
    snapshotExample: {
      screen: "menu",
      started: false,
      status: "ready",
      mapOpen: false,
      actions: {
        start: true,
        continue: false,
        restart: false,
        "open-map": true,
        "close-map": false,
        "return-menu": false,
      },
    },
    actionAvailability:
      "snapshot.actions is a Record<GameAction, boolean>, NOT an array. Use snapshot.actions[action]. Never use includes().",
    mapOwnership:
      "open-map opens the real host journey map. The v1 snapshot provides no map nodes or route data. Do not build a second map, fake route list or placeholder overlay. mapOpen only indicates that the host map is open.",
  },
  exampleEntry: `import "./menu.css";
export function mount({root,game,context}) {
  const panel=document.createElement('section');
  const title=document.createElement('h1');title.textContent=context.title;
  const primary=document.createElement('button');primary.type='button';
  const map=document.createElement('button');map.type='button';map.textContent=context.copy.map;
  panel.append(title,primary,map);root.append(panel);
  const action=()=>{const s=game.getSnapshot();return s.status==='completed'?'restart':s.started?'continue':'start'};
  const render=()=>{const s=game.getSnapshot();primary.disabled=!s.actions[action()];map.disabled=!s.actions['open-map'];primary.textContent=s.status==='loading'?context.copy.loading:s.status==='starting'?context.copy.starting:context.copy[action()]};
  primary.onclick=()=>game.invoke(action());map.onclick=()=>game.invoke('open-map');
  const unsubscribe=game.subscribe(render);render();
  return ()=>{unsubscribe();panel.remove()};
}`,
  requirements:
    "Use actual snapshot action availability for disabled controls. Start/Continue/Restart and Map must remain reachable, including short and narrow windows; shrink the cover and allow scrolling rather than hiding controls. Use context.copy labels without hardcoded localized fallbacks, real buttons, keyboard focus, 44px targets, responsive layout, and cover image object-fit:contain. Respect prefers-reduced-motion. Never fake game state, duplicate the host map or mutate the film graph.",
  isolation:
    "Opaque-origin sandbox prevents platform DOM/cookies/storage access, forms, popups and top navigation. CSP blocks fetch, remote scripts and other resource loads except the cover image and bundled SVG. The host detects and removes a self-navigated frame; this is not a process or network sandbox. Only the Game SDK port crosses the boundary.",
} as const;
