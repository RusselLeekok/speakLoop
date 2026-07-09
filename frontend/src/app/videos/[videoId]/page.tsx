"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Captions, Clock, Play, RotateCcw } from "lucide-react";

import { SiteHeader } from "@/components/site-header";
import { VideoCover } from "@/components/video-cover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import { getLocalProgress } from "@/lib/local-progress";
import type { Progress, VideoDetail } from "@/lib/types";
import { formatDuration } from "@/lib/utils";

export default function VideoDetailPage() {
  const params = useParams<{ videoId: string }>();
  const videoId = Number(params.videoId);
  const token = useAuthStore((s) => s.token);

  const { data: video, isLoading, error } = useQuery({
    queryKey: ["video", videoId],
    queryFn: () => api.get<VideoDetail>(`/api/videos/${videoId}`),
    enabled: Number.isFinite(videoId),
  });

  const { data: serverProgress } = useQuery({
    queryKey: ["progress", videoId, token],
    queryFn: () => api.get<Progress | null>(`/api/videos/${videoId}/progress`),
    enabled: !!token && Number.isFinite(videoId),
  });

  const progressMs =
    serverProgress?.last_time_ms ?? getLocalProgress(videoId)?.last_time_ms ?? 0;
  const hasProgress = progressMs > 3000;
  const tags = video?.tags?.length ? video.tags.slice(0, 4) : video?.category ? [video.category] : [];

  return (
    <div className="min-h-screen bg-aurora">
      <SiteHeader />
      <main className="container max-w-6xl py-8 sm:py-10">
        {isLoading ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
            <Skeleton className="aspect-video w-full rounded-lg" />
            <Skeleton className="h-80 w-full rounded-lg" />
          </div>
        ) : error || !video ? (
          <div className="surface flex flex-col items-center gap-4 py-20 text-center">
            <p className="text-lg font-black">视频不存在或暂未发布</p>
            <Button variant="outline" asChild>
              <Link href="/">返回首页</Link>
            </Button>
          </div>
        ) : (
          <article className="surface animate-fade-up overflow-hidden bg-white/90 p-3 md:p-4">
            <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,1.18fr)_minmax(320px,0.82fr)]">
              <Link
                href={`/learn/${video.id}`}
                className="group relative block overflow-hidden rounded-lg bg-secondary shadow-elevated ring-1 ring-foreground/10"
                aria-label={`播放 ${video.title}`}
              >
                <VideoCover src={video.cover_url} alt={video.title} className="rounded-lg" />
                <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgba(18,27,43,0.72),transparent_46%),linear-gradient(to_bottom,rgba(255,255,255,0.16),transparent_28%)]" />
                <span className="absolute left-4 top-4 rounded-md bg-white/90 px-3 py-1 text-xs font-black text-foreground shadow-soft backdrop-blur">
                  素材预览
                </span>
                <span className="absolute right-4 top-4 flex items-center gap-1 rounded-md bg-foreground/80 px-3 py-1 text-xs font-black text-white shadow-soft backdrop-blur">
                  <Clock className="h-3.5 w-3.5" />
                  {formatDuration(video.duration)}
                </span>
                <span className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/70 bg-white/90 text-foreground shadow-elevated backdrop-blur transition-transform group-hover:scale-105">
                  <Play className="ml-1 h-7 w-7" />
                </span>
                <div className="absolute inset-x-0 bottom-0 p-5 text-white">
                  <p className="line-clamp-2 text-xl font-black leading-tight drop-shadow md:text-2xl">
                    {video.title}
                  </p>
                  <p className="mt-2 flex items-center gap-2 text-sm font-bold text-white/90">
                    <Captions className="h-4 w-4" />
                    {video.subtitle_count} 句字幕 · 点击进入练习
                  </p>
                </div>
              </Link>

              <div className="flex flex-col justify-between rounded-lg bg-white/60 p-6 ring-1 ring-foreground/10 md:p-8">
                <div className="space-y-5">
                  <div className="swiss-label text-brand">素材详情</div>
                  <div className="flex flex-wrap items-center gap-2">
                    {tags.map((tag) => (
                      <Badge key={tag} variant="secondary">{tag}</Badge>
                    ))}
                    <span className="flex items-center gap-1 rounded-md border border-foreground/10 bg-white px-2 py-1 text-sm font-bold shadow-sm">
                      <Clock className="h-4 w-4" />
                      {formatDuration(video.duration)}
                    </span>
                    <span className="flex items-center gap-1 rounded-md border border-foreground/10 bg-white px-2 py-1 text-sm font-bold shadow-sm">
                      <Captions className="h-4 w-4" />
                      {video.subtitle_count} 句字幕
                    </span>
                  </div>
                  <h1 className="text-4xl font-black leading-tight tracking-[-0.02em] md:text-5xl">
                    {video.title}
                  </h1>
                  <p className="doodle-note whitespace-pre-wrap p-4 text-sm font-semibold leading-7 text-foreground">
                    {video.description || "暂无简介。可以直接开始练习，边听边建立自己的句子节奏。"}
                  </p>
                </div>
                <div className="mt-8 flex flex-wrap gap-3">
                  <Button size="lg" variant="brand" asChild>
                    <Link href={`/learn/${video.id}`}>
                      {hasProgress ? <RotateCcw /> : <Play />}
                      {hasProgress
                        ? `继续学习（${formatDuration(progressMs / 1000)}）`
                        : "开始学习"}
                    </Link>
                  </Button>
                  <Button size="lg" variant="outline" asChild>
                    <Link href="/#materials">返回列表</Link>
                  </Button>
                </div>
              </div>
            </div>
          </article>
        )}
      </main>
    </div>
  );
}
