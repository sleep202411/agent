/**
 * A subtle, slowly-drifting monochrome gradient backdrop for the homepage hero —
 * in the spirit of imagine.art's faint radial wash, but ZERO-CHROMA per our
 * DESIGN.md (pure white/gray glows over #0F0F0F, no colour). Three soft radial
 * blooms drift on long, offset loops so the background reads as a gentle living
 * gradient. Transform-only animation (GPU-composited, no blur filter) keeps it
 * smooth. Purely decorative — aria-hidden, pointer-events-none.
 */
export function GradientBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 z-0 h-screen overflow-hidden"
    >
      <style>{`
@keyframes fizzDriftA{0%,100%{transform:translate(-6%,-4%) scale(1)}50%{transform:translate(7%,6%) scale(1.25)}}
@keyframes fizzDriftB{0%,100%{transform:translate(6%,2%) scale(1.2)}50%{transform:translate(-7%,-4%) scale(1)}}
@keyframes fizzDriftC{0%,100%{transform:translate(-2%,5%) scale(1.05)}50%{transform:translate(4%,-6%) scale(0.92)}}
`}</style>
      <div
        className="absolute -top-[12%] -left-[8%] h-[78vh] w-[58vw] bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.06)_0%,transparent_60%)]"
        style={{ animation: "fizzDriftA 26s ease-in-out infinite" }}
      />
      <div
        className="absolute top-[6%] -right-[6%] h-[68vh] w-[48vw] bg-[radial-gradient(circle_at_center,rgba(235,235,238,0.05)_0%,transparent_62%)]"
        style={{ animation: "fizzDriftB 34s ease-in-out infinite" }}
      />
      <div
        className="absolute -top-[18%] left-[32%] h-[64vh] w-[52vw] bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.04)_0%,transparent_65%)]"
        style={{ animation: "fizzDriftC 42s ease-in-out infinite" }}
      />
    </div>
  );
}
