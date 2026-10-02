"use client";

import { Fragment, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useAuth } from "@/app/_components/auth-provider";
import { Link } from "@/i18n/navigation";
import { ApiRequestError } from "@/lib/api";
import { getProject, type ProjectRef } from "@/lib/collab/projects-api";

export function ProjectAccessBoundary({
  projectId,
  children,
}: {
  projectId: string;
  children: (project: ProjectRef) => ReactNode;
}) {
  const { user, loading, signIn } = useAuth();
  const t = useTranslations("project");
  const common = useTranslations("common");
  const auth = useTranslations("auth");
  const query = useQuery({
    queryKey: ["platform-project-access", user?.id ?? null, projectId],
    queryFn: ({ signal }) => getProject(projectId, signal),
    enabled: Boolean(user) && !loading,
    retry: false,
  });
  const unavailable =
    query.error instanceof ApiRequestError && [401, 403, 404, 410].includes(query.error.status);
  const role = query.data?.role;
  const knownRole = role === "owner" || role === "admin" || role === "editor" || role === "viewer";
  const retry = (
    <button
      type="button"
      disabled={query.isFetching}
      onClick={() => void query.refetch()}
      className="rounded-full bg-white/[0.08] px-4 py-2 text-sm text-white/80 hover:bg-white/[0.12] disabled:opacity-50"
    >
      {common("retry")}
    </button>
  );
  if (loading || (user && query.isPending))
    return (
      <div role="status" className="grid h-dvh place-items-center text-sm text-white/50">
        {common("loading")}
      </div>
    );
  if (!user || !query.data || !knownRole || unavailable)
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 px-6 text-center text-sm">
        <p role="alert" className="max-w-md text-white/60">
          {!user
            ? auth("identifierTitle")
            : query.error instanceof Error
              ? query.error.message
              : t("documentOpenError")}
        </p>
        {!user ? (
          <button
            type="button"
            onClick={signIn}
            className="rounded-full bg-white/[0.08] px-4 py-2 text-white/80 hover:bg-white/[0.12]"
          >
            {auth("signIn")}
          </button>
        ) : (
          retry
        )}
        <Link href="/projects" className="text-white/55 hover:text-white">
          {t("backToProjects")}
        </Link>
      </div>
    );
  return (
    <div className="relative">
      {query.isError ? (
        <div className="absolute inset-x-0 bottom-0 z-50 flex items-center justify-between gap-4 bg-background px-6 py-3 text-sm">
          <p role="alert" className="text-white/60">
            {query.error instanceof Error ? query.error.message : common("error")}
          </p>
          {retry}
        </div>
      ) : null}
      <Fragment key={`${user.id}:${projectId}`}>{children(query.data)}</Fragment>
    </div>
  );
}
