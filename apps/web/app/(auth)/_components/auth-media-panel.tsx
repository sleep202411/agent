"use client";

/**
 * Right-hand pane — one big cover image. Set `HERO_SRC` to the path
 * of the artwork you want to feature (put the file in
 * `apps/web/public/`). Empty string = just show the muted background
 * until art drops in. Hidden on <lg so the form carries mobile alone.
 */

// Pawel Czerwinski abstract art — Unsplash, free to hotlink.
// Swap to your own OSS asset when ready.
const HERO_SRC =
  "https://images.unsplash.com/photo-1557672172-298e090bd0f1?auto=format&fit=crop&w=1600&q=85";

export function AuthMediaPanel() {
  return (
    <section
      aria-hidden
      className="relative hidden h-screen flex-1 select-none overflow-hidden p-4 lg:flex"
    >
      {HERO_SRC ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={HERO_SRC} alt="" className="h-full w-full object-cover rounded-xl" />
      ) : null}
    </section>
  );
}
