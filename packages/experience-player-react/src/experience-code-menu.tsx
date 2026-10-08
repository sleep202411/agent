"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { attachGameSessionPort } from "@repo/game-sdk/port";
import type { GameUIArtifact } from "@repo/shared/experience-runtime";
import type { ExperienceMainMenuUIProps } from "./experience-ui";
import { ExperienceDefaultMainMenuUI } from "./experience-main-menu";
import { codeMenuDocument } from "./experience-code-menu-document";

type CodeMenuProps = ExperienceMainMenuUIProps & {
  artifact: GameUIArtifact;
  coverUrl?: string;
  failureCopy: { failed: string; retry: string; restore: string };
};

export function ExperienceCodeMenu(props: CodeMenuProps) {
  const identity = JSON.stringify({
    artifact: props.artifact.artifactHash,
    title: props.title,
    summary: props.summary,
    eyebrow: props.eyebrow,
    copy: props.copy,
    coverUrl: props.coverUrl,
  });
  return <CodeMenuFrame key={identity} {...props} />;
}

function CodeMenuFrame({ artifact, coverUrl, failureCopy, ...props }: CodeMenuProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const loadedCredential = useRef<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState("");
  const [restored, setRestored] = useState(false);
  const [ready, setReady] = useState(false);
  const [credential, setCredential] = useState<string | null>(null);
  useEffect(() => {
    setCredential(crypto.randomUUID());
    setReady(false);
    setFailed("");
    setRestored(false);
  }, [attempt]);
  const absoluteCoverUrl =
    coverUrl && typeof window !== "undefined"
      ? new URL(coverUrl, window.location.href).href
      : undefined;
  const document = useMemo(
    () => (credential ? codeMenuDocument(artifact, credential, absoluteCoverUrl) : ""),
    [artifact, credential, absoluteCoverUrl]
  );
  const context = useRef({ ...props, session: undefined, coverUrl: absoluteCoverUrl });
  context.current = { ...props, session: undefined, coverUrl: absoluteCoverUrl };
  useEffect(() => {
    if (!credential || restored || failed) return;
    loadedCredential.current = null;
    let dispose: (() => void) | undefined;
    let port: MessagePort | undefined;
    let previous = props.session.getSnapshot();
    const timeout = setTimeout(() => setFailed("Game UI did not finish loading."), 12_000);
    const unsubscribe = props.session.subscribe(() => {
      const next = props.session.getSnapshot();
      // The port subscription sends the new availability first. Focusing a
      // still-disabled origin button would silently leave focus on the body.
      if (previous.mapOpen && !next.mapOpen)
        queueMicrotask(() => port?.postMessage({ type: "focus" }));
      previous = next;
    });
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== "null" ||
        event.data?.type !== "fizz.game.ready" ||
        event.data?.credential !== credential ||
        dispose
      )
        return;
      const channel = new MessageChannel();
      port = channel.port1;
      dispose = attachGameSessionPort(
        props.session,
        port,
        context.current,
        () => {
          clearTimeout(timeout);
          setReady(true);
          if (window.document.hasFocus()) port?.postMessage({ type: "focus" });
        },
        (message) => {
          clearTimeout(timeout);
          setFailed(message);
        }
      );
      frame.current.contentWindow!.postMessage({ type: "fizz.game.connect", credential }, "*", [
        channel.port2,
      ]);
    };
    window.addEventListener("message", receive);
    return () => {
      clearTimeout(timeout);
      unsubscribe();
      dispose?.();
      port = undefined;
      window.removeEventListener("message", receive);
    };
  }, [credential, document, props.session, restored, failed]);
  if (restored) return <ExperienceDefaultMainMenuUI {...props} />;
  if (failed)
    return (
      <div
        className="relative z-10 flex max-w-md flex-col gap-3 rounded-2xl bg-black/80 p-6"
        role="alert"
      >
        <p>{failureCopy.failed}</p>
        <p className="break-words text-sm text-white/60">{failed}</p>
        <button
          type="button"
          className="min-h-11 rounded-xl bg-white/15 p-3"
          onClick={() => {
            setFailed("");
            setReady(false);
            setAttempt((value) => value + 1);
          }}
        >
          {failureCopy.retry}
        </button>
        <button
          type="button"
          className="min-h-11 rounded-xl bg-white/10 p-3"
          onClick={() => setRestored(true)}
        >
          {failureCopy.restore}
        </button>
      </div>
    );
  if (!credential) return null;
  return (
    <iframe
      key={credential}
      ref={frame}
      title={props.title}
      data-game-code-menu=""
      sandbox="allow-scripts"
      allow="autoplay"
      referrerPolicy="no-referrer"
      srcDoc={document}
      aria-busy={!ready}
      onLoad={() => {
        if (loadedCredential.current === credential)
          setFailed("Game UI navigated away from its sandbox document.");
        else loadedCredential.current = credential;
      }}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
    />
  );
}
