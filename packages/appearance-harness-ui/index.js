export const inject = ["webServer"];
export function apply(ctx, config) {
  const boot = JSON.stringify(config).replaceAll("<", "\\u003c");
  ctx.webServer.tapIndex((html) =>
    html
      .replace(/<link\b[^>]*\brel=["'](?:icon|manifest)["'][^>]*>/gi, "")
      .replace("<title>DeepSeek Harness</title>", "<title>FizzDragon</title>")
      .replace(
        "</head>",
        `<link rel="icon" href="${new URL("/favicon.ico", config.parentOrigin).href}"><script>window.__FIZZ_APPEARANCE__=${boot}</script><style>[data-rightbar-collapsed]{grid-template-columns:0 minmax(0,1fr) 0!important}[data-conversation-scroll]>[data-composer-seat]{margin-top:auto}
      /* Remove the upstream decorative whale; keep the live clock/status. */
      [data-chat-running] [aria-hidden="true"]:has(>svg){display:none}
      </style></head>`
      )
  );
}
