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
    // Mobile (<lg): natural page height so the playlist can scroll with
    // the whole page — sticky video pins the player at the top while
    // the user browses episodes. Desktop (lg+): locked to viewport with
    // independent scroll regions per pane.
    <main className="bg-[#08080d] text-white lg:h-[calc(100vh-4rem)] lg:overflow-hidden">
      {isLoading ? (
        <div className="flex min-h-[60vh] items-center justify-center lg:h-full lg:min-h-0">
          <Spinner className="size-7 text-[#ff5967]" />
        </div>
      ) : null}

      {error ? (
        <div className="flex min-h-[60vh] items-center justify-center px-5 lg:h-full lg:min-h-0">
          <Alert variant="destructive" className="max-w-xl border-[#3a2230] bg-[#111119]">
            <IconAlertCircle />
            <AlertTitle>{t("loadFailedTitle")}</AlertTitle>
            <AlertDescription>{t("loadFailedDescription")}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      {!isLoading && !error ? (
        <div className="lg:grid lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_400px]">
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
