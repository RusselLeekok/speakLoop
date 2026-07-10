"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";

import { PendingLink } from "@/components/pending-link";
import { VideoFinalizePanel } from "@/components/admin/video-finalize-panel";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import type { VideoAdmin } from "@/lib/types";
import { formatDuration, formatFileSize } from "@/lib/utils";

export default function AdminVideoEditPage() {
  const params = useParams<{ videoId: string }>();
  const videoId = Number(params.videoId);
  const router = useRouter();

  const { data: video, isLoading } = useQuery({
    queryKey: ["admin-video", videoId],
    queryFn: () => api.get<VideoAdmin>(`/api/admin/videos/${videoId}`),
    enabled: Number.isFinite(videoId),
  });

  if (isLoading || !video) {
    return (
      <div className="w-full max-w-none space-y-4">
        <Skeleton className="h-10 w-80" />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
          <Skeleton className="h-[68vh] rounded-lg" />
          <Skeleton className="h-[68vh] rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-none space-y-6">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4">
        <Button variant="ghost" size="icon" asChild>
          <PendingLink href="/admin/videos" aria-label="返回视频列表">
            <ArrowLeft />
          </PendingLink>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-3xl font-bold tracking-normal">{video.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm font-semibold text-muted-foreground">
            <StatusBadge status={video.status} />
            <span>{formatDuration(video.duration)}</span>
            <span>{formatFileSize(video.file_size)}</span>
            <span>{video.subtitle_count} 句字幕</span>
          </div>
        </div>
      </div>

      <VideoFinalizePanel videoId={video.id} onDeleted={() => router.push("/admin/videos")} />
    </div>
  );
}
