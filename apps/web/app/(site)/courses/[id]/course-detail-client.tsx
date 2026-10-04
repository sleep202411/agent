"use client";

import { useEffect, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { CourseLoadError } from "../_components/CourseLoadError";
import { Spinner } from "@/components/ui/spinner";
import { useTranslations } from "@/src/i18n/i18n";
import { usePublicCourseDetail } from "@/src/hooks/use-courses-public";
import { isCourseApiError } from "@/src/services/courses";
import { CourseVideoPlayer } from "../_components/CourseVideoPlayer";
import { PublicCourseDetailPanel } from "../_components/PublicCourseDetailPanel";

/**
 * Course detail — playlist + signed play URL from `/project/courses`.
 */
export default function CourseDetailClient({ preview }: { preview?: ReactNode }) {
  const t = useTranslations("courses");
  const params = useParams<{ id: string }>();
  const {
    isLoading,
    error,
    playError,
    detail,
    currentTitle,
    seriesVideoIds,
    stableProgressKey,
    setCurrentVideo,
    isFetching,
    retryDetail,
    isPlayFetching,
    retryPlayback,
  } = usePublicCourseDetail(params.id);

  useEffect(() => {
    if (isCourseApiError(playError, 403)) {
      toast.error(t("accessDenied"), {
        id: `course-video-no-permission-${detail?.currentVideoId}`,
      });
    }
  }, [detail?.currentVideoId, playError, t]);

  return (
    <main className="bg-[#08080d] text-white lg:h-[calc(100vh-4rem)] lg:overflow-hidden">
      {isLoading ? (
        <div className="flex min-h-[60vh] items-center justify-center lg:h-full lg:min-h-0">
          {preview ?? <Spinner className="size-7 text-[#ff5967]" />}
        </div>
      ) : null}

      {error || (!isLoading && !detail) ? (
        <div className="flex min-h-[60vh] items-center justify-center px-5 lg:h-full lg:min-h-0">
          <CourseLoadError
            error={error}
            retry={retryDetail ? () => void retryDetail() : undefined}
            busy={isFetching}
          />
        </div>
      ) : null}

      {!isLoading && !error && detail ? (
        <div className="lg:grid lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_480px] xl:grid-cols-[minmax(0,1fr)_520px]">
          {playError ? (
            <div className="flex items-center justify-center p-5">
              <CourseLoadError
                error={playError}
                retry={() => void retryPlayback()}
                busy={isPlayFetching}
              />
            </div>
          ) : (
            <CourseVideoPlayer
              key={detail.currentVideoId ?? detail.courseId}
              courseId={detail.currentVideoId ?? detail.courseId}
              seriesCourseId={detail.courseId}
              seriesVideoIds={seriesVideoIds}
              title={currentTitle || detail.title}
              videoUrl={isCourseApiError(playError, 403) ? "" : detail.videoUrl}
              posterUrl={detail.currentPosterUrl || undefined}
              stableProgressKey={stableProgressKey}
            />
          )}
          <PublicCourseDetailPanel detail={detail} onVideoSelect={setCurrentVideo} />
        </div>
      ) : null}
    </main>
  );
}
