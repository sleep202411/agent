/**
 * Last remaining legacy uni-app surface. Native `/courses/[id]` owns
 * course detail; this path only keeps the old catalogue iframe alive.
 *
 * The iframe src is rewritten by next.config to `public/legacy.html`.
 * The bundle then strips `/__legacy` so its history router sees
 * `/pages/course/course`.
 */
export default function LegacyCourseCataloguePage() {
  return (
    <iframe
      src="/__legacy/pages/course/course"
      title="Legacy course catalogue"
      className="block w-full border-0"
      style={{ height: "calc(100vh - 4rem)" }}
    />
  );
}
