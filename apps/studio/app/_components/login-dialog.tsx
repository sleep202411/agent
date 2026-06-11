"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { IconLoader2, IconX } from "@tabler/icons-react";
import { login } from "@/lib/auth";

/** The hero artwork's own prompt — shown as a caption (it was generated with
 *  FizzStudio's gpt-image-2, which is the best ad for the product). */
const HERO_PROMPT =
  "A cinematic portrait in avant-garde fashion, sculptural crimson fabric, a luminous origami dragon perched on her shoulder, dramatic studio lighting";

/**
 * Global sign-in dialog (imagine.art layout): form panel + hero artwork.
 * Email / phone + password only — the same Java login the web app uses.
 */
export function LoginDialog({
  onClose,
  onLoggedIn,
}: {
  onClose: () => void;
  onLoggedIn: () => void;
}) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const canSubmit = identifier.trim().length > 2 && password.length >= 6 && !submitting;

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await login(identifier, password);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
      <div className="relative flex max-h-[min(720px,calc(100vh-3rem))] w-full max-w-[920px] overflow-hidden rounded-3xl bg-[oklch(0.16_0_0)] shadow-2xl shadow-black/60 duration-200 animate-in fade-in-0 zoom-in-95">
        {/* Form panel */}
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center px-8 py-12 sm:px-12">
          <Image src="/logo.png" alt="FizzDragon" width={439} height={78} className="h-8 w-auto" />
          <h2 className="mt-5 text-xl font-semibold">Welcome to FizzStudio</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Sign in with your FizzDragon account
          </p>

          <form onSubmit={submit} className="mt-8 w-full max-w-sm space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-white/70">Email or phone</span>
              <input
                type="text"
                autoFocus
                autoComplete="username"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="you@example.com"
                className="h-11 w-full rounded-xl bg-input/25 px-3.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-white/70">Password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                className="h-11 w-full rounded-xl bg-input/25 px-3.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </label>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <button
              type="submit"
              disabled={!canSubmit}
              // Brand red as the hero CTA — sanctioned case-by-case accent.
              className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#E52227] text-sm font-semibold text-white shadow-lg shadow-[#E52227]/25 transition-colors hover:bg-[#c91e22] disabled:opacity-40"
            >
              {submitting && <IconLoader2 className="size-4 animate-spin" stroke={2} />}
              Sign in
            </button>
          </form>

          <p className="mt-6 max-w-sm text-center text-xs leading-5 text-muted-foreground">
            No account yet? Create one on{" "}
            <a
              href="https://fizzdragon.com"
              target="_blank"
              rel="noreferrer"
              className="text-white/80 underline-offset-2 hover:underline"
            >
              fizzdragon.com
            </a>{" "}
            first.
          </p>
        </div>

        {/* Hero artwork */}
        <div className="relative hidden w-[400px] shrink-0 md:block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/login-hero.png" alt="" className="absolute inset-0 size-full object-cover" />
          <div className="absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-[oklch(0.16_0_0)] to-transparent" />
          {/* Prompt caption */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 pt-10">
            <p className="line-clamp-2 text-[11px] leading-4 text-white/80">{HERO_PROMPT}</p>
            <p className="mt-1.5 text-[10px] font-medium text-white/50">
              Generated with FizzStudio · GPT Image 2
            </p>
          </div>
        </div>

        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute top-4 right-4 z-10 flex size-9 items-center justify-center rounded-full bg-black/45 text-white/80 backdrop-blur-md transition-colors hover:bg-black/65 hover:text-white"
        >
          <IconX className="size-4.5" stroke={1.8} />
        </button>
      </div>
    </div>,
    document.body
  );
}
