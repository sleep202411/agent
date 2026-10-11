import Link from "next/link";

export function CourseLearningPagination({
  path,
  after,
  nextCursor,
}: {
  path: "/courses/homework" | "/courses/income";
  after?: string;
  nextCursor?: string | null;
}) {
  if (!after && !nextCursor) return null;
  const style =
    "rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2";
  return (
    <nav aria-label="Course records pagination" className="mt-4 flex justify-end gap-2">
      {after ? (
        <Link href={path} className={style}>
          First page
        </Link>
      ) : null}
      {nextCursor ? (
        <Link href={`${path}?after=${encodeURIComponent(nextCursor)}`} className={style}>
          Next page
        </Link>
      ) : null}
    </nav>
  );
}
