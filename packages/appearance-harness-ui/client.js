// Official Harness loads browser plugins through its module system. Only host
// composition, session selection and draft handoff live here. All conversation,
// input, streaming, stop, errors and scrolling are the upstream components.
window.__ModuleLoader__.load({
  id: "@repo/appearance-harness-ui",
  factory(require) {
    const React = require("react");
    return {
      inject: ["slots", "uiWorkspace", "workspaces", "sessions", "conversation", "locale", "theme"],
      apply(ctx) {
        const boot = window.__FIZZ_APPEARANCE__;
        const tokens = {
          "--dsw-alias-bg-base": "#0f0f0f",
          "--dsw-alias-bg-layer-1": "#1a1a1a",
          "--dsw-alias-bg-layer-2": "#242424",
          "--dsw-specific-input-major": "#242424",
          "--dsw-specific-bubble": "#242424",
          "--dsw-alias-button-info-fill": "#e52227",
          "--dsw-alias-button-info-hover": "color-mix(in srgb, #e52227, black 14%)",
          "--dsw-alias-state-business-primary": "#ff6b6f",
          "--dsw-alias-state-business-tertiary": "#242424",
          "--dsw-alias-link": "#ff6b6f",
          "--dsw-alias-label-deep-diving": "#a3a3a3",
          "--dsw-alias-label-deep-diving-shimmer": "#ffffff",
          "--dsw-alias-brand-primary-new-colorprimary-new-color": "#e52227",
        };
        ctx.effect(() =>
          ctx.theme.overrideTokens(
            "@repo/appearance-harness-ui",
            Object.fromEntries(
              Object.entries(tokens).map(([name, value]) => [name, { light: value, dark: value }])
            )
          )
        );
        ctx.theme.setTheme("dark");
        // A small official language pack overrides brand copy; all other keys
        // retain Harness's translations through its per-key fallback chain.
        ctx.effect(() =>
          ctx.locale.addLanguage({
            id: boot.locale,
            label: boot.locale,
            fallback: boot.locale === "en-US" ? "en" : "zh",
          })
        );
        ctx.effect(() =>
          ctx.locale.register("chat", boot.locale, {
            "chat.deepDiving": boot.copy.working,
            "chat.deepDivingFor": boot.copy.workingFor,
          })
        );
        ctx.locale.setLocale(boot.locale);
        ctx.effect(() =>
          ctx.locale.register("conversation", boot.locale, {
            "placeholder.default": ctx.locale.bind("conversation")("input.send"),
          })
        );
        // This project mounts one pinned session. Upstream has no capability
        // switch for these two built-in controls; its slots can only add actions
        // or replace the whole chat/composer. Scope their presentation to this
        // mount and resolve labels through the same official locale registry.
        ctx.effect(() => {
          const style = document.createElement("style");
          style.dataset.fizzAppearanceControls = "";
          const chat = ctx.locale.bind("chat");
          const conversation = ctx.locale.bind("conversation");
          const update = () => {
            const branch = CSS.escape(chat("message.branch"));
            const commands = CSS.escape(conversation("input.commands"));
            style.textContent = `
              [data-fizz-appearance] [data-turn-tail] button[aria-label="${branch}"],
              [data-fizz-appearance] [data-composer-card] button[aria-haspopup="listbox"][aria-label="${commands}"]
              { display: none !important; }
            `;
          };
          document.head.append(style);
          update();
          const unsubscribe = ctx.locale.subscribe(update);
          return () => {
            unsubscribe();
            style.remove();
          };
        });
        // AppFrame's product title is a build literal in this upstream version.
        // Keep session titles intact and replace only its product-name suffix.
        ctx.effect(() => {
          const title = document.querySelector("title");
          const brandTitle = () => {
            if (document.title.endsWith("DeepSeek Harness"))
              document.title = document.title.replace(/DeepSeek Harness$/, "FizzDragon");
          };
          const observer = new MutationObserver(brandTitle);
          if (title)
            observer.observe(title, { childList: true, characterData: true, subtree: true });
          brandTitle();
          return () => observer.disconnect();
        });
        ctx.slots.inject("main.conversation", () =>
          ctx.slots.register(
            { name: "main.conversation", priority: -100 },
            ({ renderFactorySlot }) =>
              React.createElement(
                "section",
                {
                  "data-fizz-appearance": true,
                  style: { height: "100%", minHeight: 0, display: "flex", flexDirection: "column" },
                },
                React.createElement(
                  "header",
                  {
                    style: {
                      height: 48,
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "center",
                      padding: "0 18px",
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#f5f5f5",
                      letterSpacing: "-0.02em",
                    },
                  },
                  "FizzAgent"
                ),
                renderFactorySlot("conversation.content", {
                  variant: "embedded",
                  phase: "active",
                  hero: false,
                })
              )
          )
        );
        // The private proxy prepares only this project session before the GUI
        // loads. Adopt it through the official client controller before selecting
        // it: the browser's session index is populated asynchronously.
        void (async () => {
          const workspace = await ctx.workspaces.create({ path: boot.cwd });
          await ctx.workspaces.rename(workspace.workspaceId, boot.title);
          const id = await ctx.sessions.create({
            sessionId: boot.sessionId,
            workspaceId: workspace.workspaceId,
          });
          ctx.uiWorkspace.openSession(id);
          const ref = ctx.sessions.retain(id, { source: "workspaceOperation" });
          await ref.ready;
          ctx.theme.setTheme("dark");
          const input = ctx.conversation.input.for(ref.binding.ctx);
          const handoff = `fizz.appearance.draft-handoff:${id}`;
          if (!localStorage.getItem(handoff)) {
            if (boot.draft && !input.state.getSnapshot().draft) input.setDraft(boot.draft);
            localStorage.setItem(handoff, "done");
          }
          const publish = () =>
            window.parent.postMessage(
              { type: "fizz.appearance.draft", text: input.state.getSnapshot().draft },
              boot.parentOrigin
            );
          const off = input.state.subscribe(publish);
          const publishRunning = () =>
            window.parent.postMessage(
              {
                type: "fizz.appearance.running",
                running: ref.binding.session.getSnapshot().running,
              },
              boot.parentOrigin
            );
          const offSession = ref.binding.session.subscribe(publishRunning);
          publishRunning();
          ctx.effect(() => () => {
            off();
            offSession();
            ref.release();
          });
          window.parent.postMessage({ type: "fizz.appearance.ready" }, boot.parentOrigin);
        })().catch((error) => {
          window.parent.postMessage(
            {
              type: "fizz.appearance.error",
              message: error instanceof Error ? error.message : String(error),
            },
            boot.parentOrigin
          );
        });
      },
    };
  },
});
