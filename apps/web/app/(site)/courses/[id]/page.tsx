"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { IconAlertCircle } from "@tabler/icons-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { useTranslations } from "@/src/i18n/i18n";
import { usePublicCourseDetail } from "@/src/hooks/use-courses-public";
import { isCourseApiError } from "@/src/services/courses";
import { CourseVideoPlayer } from "../_components/CourseVideoPlayer";
import { PublicCourseDetailPanel } from "../_components/PublicCourseDetailPanel";

/**
 * Course detail — playlist + signed play URL from `/project/courses`.
 */
export default function CourseDetailPage() {
  const t = useTranslations("courses");
  const params = useParams<{ id: string }>();
  const { isLoading, error, playError, detail, currentTitle, stableProgressKey, setCurrentVideo } =
    usePublicCourseDetail(params.id);

  useEffect(() => {
    if (isCourseApiError(playError, 403)) {
      toast.error("暂无权限，您可以联系 business@fizzdragon.com 为您开通权限", {
        id: `course-video-no-permission-${detail?.currentVideoId}`,
      });
    }
  }, [detail?.currentVideoId, playError]);

  return (
    <main className="bg-[#08080d] text-white lg:h-[calc(100vh-4rem)] lg:overflow-hidden">
      {isLoading ? (
        <div className="flex min-h-[60vh] items-center justify-center lg:h-full lg:min-h-0">
          <Spinner className="size-7 text-[#ff5967]" />
        </div>
      ) : null}

      {error || (!isLoading && !detail) ? (
        <div className="flex min-h-[60vh] items-center justify-center px-5 lg:h-full lg:min-h-0">
          <Alert variant="destructive" className="max-w-xl border-[#3a2230] bg-[#111119]">
            <IconAlertCircle />
            <AlertTitle>{t("loadFailedTitle")}</AlertTitle>
            <AlertDescription>{t("loadFailedDescription")}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      {!isLoading && detail ? (
        <div className="lg:grid lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_480px] xl:grid-cols-[minmax(0,1fr)_520px]">
          <CourseVideoPlayer
            key={detail.currentVideoId ?? detail.courseId}
            courseId={detail.currentVideoId ?? detail.courseId}
            title={currentTitle || detail.title}
            videoUrl={isCourseApiError(playError, 403) ? "" : detail.videoUrl}
            posterUrl={detail.currentPosterUrl || undefined}
            stableProgressKey={stableProgressKey}
          />
          <PublicCourseDetailPanel detail={detail} onVideoSelect={setCurrentVideo} />
        </div>
      ) : null}
    </main>
  );
}
