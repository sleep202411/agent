"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { IconAlertCircle } from "@tabler/icons-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { useTranslations } from "@/src/i18n/i18n";
import { useCourseDetail } from "@/src/hooks/use-courses";
import { isCourseApiError } from "@/src/services/courses";
import { CourseDetailPanel } from "../_components/CourseDetailPanel";
import { CourseVideoPlayer } from "../_components/CourseVideoPlayer";

/**
 * 渲染课程详情页，并组合视频播放区和系列课程列表。
 */
export default function CourseDetailPage() {
  const t = useTranslations("courses");
  const params = useParams<{ id: string }>();
  const { isLoading, error, videoLinkError, detail, setCurrentEpisode, stableProgressKey } =
    useCourseDetail(params.id);
  const currentCourseId = detail.currentId;

  useEffect(() => {
    // Check for 403 permission error (both HTTP-level and business code level)
    if (isCourseApiError(videoLinkError, 403)) {
      toast.error("暂无权限，您可以联系 business@fizzdragon.com 为您开通权限", {
        id: `course-video-no-permission-${currentCourseId}`,
      });
    }
  }, [currentCourseId, videoLinkError]);

  return (
    <main className="h-[calc(100vh-4rem)] overflow-hidden bg-[#08080d] text-white">
      {isLoading ? (
        <div className="flex h-full items-center justify-center">
          <Spinner className="size-7 text-[#ff5967]" />
        </div>
      ) : null}

      {error ? (
        <div className="flex h-full items-center justify-center px-5">
          <Alert variant="destructive" className="max-w-xl border-[#3a2230] bg-[#111119]">
            <IconAlertCircle />
            <AlertTitle>{t("loadFailedTitle")}</AlertTitle>
            <AlertDescription>{t("loadFailedDescription")}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      {!isLoading && !error ? (
        <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px]">
          <CourseVideoPlayer
            key={detail.currentId}
            courseId={detail.currentId}
            title={detail.detail.title}
            videoUrl={detail.detail.vedioLink}
            stableProgressKey={stableProgressKey}
          />
          <CourseDetailPanel courseDetail={detail} onEpisodeSelect={setCurrentEpisode} />
        </div>
      ) : null}
    </main>
  );
}
