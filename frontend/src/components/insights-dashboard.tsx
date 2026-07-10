"use client";

import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  BarChart3,
  Captions,
  Clock,
  Film,
  Library,
  PieChart,
  TrendingUp,
} from "lucide-react";

import { PendingLink } from "@/components/pending-link";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import { getAllLocalProgress, type LocalProgress } from "@/lib/local-progress";
import type { Progress, VideoPublic } from "@/lib/types";
import { cn, formatDuration } from "@/lib/utils";

type ProgressRecord = Pick<Progress, "video_id" | "last_time_ms" | "last_subtitle_id" | "updated_at">;

function localProgressToRows(progress: Record<string, LocalProgress>): ProgressRecord[] {
  return Object.entries(progress).map(([videoId, row]) => ({
    video_id: Number(videoId),
    last_time_ms: row.last_time_ms,
    last_subtitle_id: row.last_subtitle_id,
    updated_at: row.updated_at,
  }));
}

function monthKey(iso: string | null | undefined) {
  if (!iso) return "No date";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "No date";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function percent(value: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(value);
}

export function InsightsDashboard() {
  const { token } = useAuthStore();
  const [localProgress, setLocalProgress] = useState<Record<string, LocalProgress>>({});

  useEffect(() => {
    setLocalProgress(getAllLocalProgress());
  }, []);

  const { data: videos, isError, isLoading } = useQuery({
    queryKey: ["insights-videos"],
    queryFn: () => api.get<VideoPublic[]>("/api/videos"),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const { data: serverProgress } = useQuery({
    queryKey: ["insights-progress", token],
    queryFn: () => api.get<Progress[]>("/api/progress"),
    enabled: !!token,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const rows = videos ?? [];
  const progressRows = useMemo<ProgressRecord[]>(
    () => (token ? serverProgress ?? [] : localProgressToRows(localProgress)),
    [localProgress, serverProgress, token]
  );

  const stats = useMemo(() => {
    const totalDuration = rows.reduce((sum, video) => sum + (video.duration ?? 0), 0);
    const totalSubtitles = rows.reduce((sum, video) => sum + video.subtitle_count, 0);
    const learnedIds = new Set(progressRows.filter((row) => row.last_time_ms > 3000).map((row) => row.video_id));
    const learnedCount = rows.filter((video) => learnedIds.has(video.id)).length;

    return {
      totalVideos: rows.length,
      totalDuration,
      totalSubtitles,
      learnedCount,
      averageSubtitleCount: rows.length ? Math.round(totalSubtitles / rows.length) : 0,
      learningMinutes: Math.round(progressRows.reduce((sum, row) => sum + Math.max(0, row.last_time_ms) / 60000, 0)),
    };
  }, [progressRows, rows]);

  const categoryBars = useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach((video) => {
      const key = video.category?.trim() || "Uncategorized";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return Array.from(counts, ([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [rows]);

  const durationBuckets = useMemo(() => {
    const buckets = [
      { label: "Under 10 min", value: 0 },
      { label: "10-20 min", value: 0 },
      { label: "Over 20 min", value: 0 },
      { label: "Unknown", value: 0 },
    ];

    rows.forEach((video) => {
      const minutes = (video.duration ?? 0) / 60;
      if (!minutes) buckets[3].value += 1;
      else if (minutes < 10) buckets[0].value += 1;
      else if (minutes <= 20) buckets[1].value += 1;
      else buckets[2].value += 1;
    });

    return buckets;
  }, [rows]);

  const denseVideos = useMemo(() => {
    return rows
      .map((video) => {
        const minutes = Math.max((video.duration ?? 0) / 60, 1);
        return { ...video, density: video.subtitle_count / minutes };
      })
      .filter((video) => video.subtitle_count > 0)
      .sort((a, b) => b.density - a.density)
      .slice(0, 6);
  }, [rows]);

  const publishedTrend = useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach((video) => {
      const key = monthKey(video.published_at);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return Array.from(counts, ([label, value]) => ({ label, value }))
      .filter((item) => item.label !== "No date")
      .sort((a, b) => a.label.localeCompare(b.label))
      .slice(-6);
  }, [rows]);

  return (
    <main id="main-content" className="min-h-screen bg-aurora px-4 py-6 text-foreground lg:px-7">
      <div className="mx-auto max-w-[1280px]">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Button variant="ghost" size="sm" asChild className="mb-4">
              <PendingLink href="/">
                <ArrowLeft className="h-4 w-4" />
                Back to workspace
              </PendingLink>
            </Button>
            <p className="mb-2 text-sm font-black text-brand">Project insights</p>
            <h1 className="text-3xl font-black leading-tight tracking-[-0.02em] text-[#1b1d2a] md:text-4xl">
              SpeakLoop content dashboard
            </h1>
            <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-muted-foreground">
              A quick visual map of the public learning library, subtitle coverage, duration mix,
              and study activity.
            </p>
          </div>
          <div className="rounded-lg border border-foreground/10 bg-white/80 px-4 py-3 text-sm font-bold text-muted-foreground shadow-sm">
            {isError ? "API offline" : isLoading ? "Loading data..." : `${stats.totalVideos} public videos analyzed`}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={Library} label="Public videos" value={compactNumber(stats.totalVideos)} />
          <MetricCard icon={Clock} label="Total runtime" value={formatDuration(stats.totalDuration)} />
          <MetricCard icon={Captions} label="Subtitle lines" value={compactNumber(stats.totalSubtitles)} />
          <MetricCard icon={TrendingUp} label="Study minutes" value={compactNumber(stats.learningMinutes)} />
        </div>

        {isError ? (
          <div className="mt-6 rounded-lg border border-dashed border-foreground/14 bg-white px-6 py-16 text-center shadow-sm">
            <h2 className="text-lg font-black">The chart is ready, but the API is offline.</h2>
            <p className="mx-auto mt-2 max-w-md text-sm font-semibold leading-6 text-muted-foreground">
              Start the backend service and this page will render live video, subtitle, and progress charts.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
            <ChartPanel
              icon={BarChart3}
              title="Category distribution"
              description="How the published learning library is split by topic."
            >
              <BarList items={categoryBars} total={stats.totalVideos} emptyLabel="No categories yet" />
            </ChartPanel>

            <ChartPanel
              icon={PieChart}
              title="Duration mix"
              description="A quick look at lesson length balance."
            >
              <DonutChart items={durationBuckets} total={stats.totalVideos} />
            </ChartPanel>

            <ChartPanel
              icon={Captions}
              title="Subtitle density"
              description="Videos with the most sentence-level practice per minute."
            >
              <DensityList videos={denseVideos} />
            </ChartPanel>

            <ChartPanel
              icon={Film}
              title="Publishing trend"
              description="Published-video count across the latest active months."
            >
              <TrendBars items={publishedTrend} />
            </ChartPanel>
          </div>
        )}
      </div>
    </main>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <section className="rounded-lg border border-foreground/10 bg-white/88 p-5 shadow-soft">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-black text-muted-foreground">{label}</p>
        <span className="flex h-10 w-10 items-center justify-center rounded-md bg-brand/10 text-brand">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-4 text-3xl font-black tracking-[-0.03em] text-foreground">{value}</p>
    </section>
  );
}

function ChartPanel({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-foreground/10 bg-white/90 p-5 shadow-soft">
      <div className="mb-5 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-lg font-black tracking-[-0.01em]">{title}</h2>
          <p className="mt-1 text-sm font-semibold leading-6 text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function BarList({ items, total, emptyLabel }: { items: Array<{ label: string; value: number }>; total: number; emptyLabel: string }) {
  if (!items.length) return <EmptyChart label={emptyLabel} />;

  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.label}>
          <div className="mb-1.5 flex items-center justify-between gap-3 text-sm font-black">
            <span className="truncate">{item.label}</span>
            <span className="text-muted-foreground">{item.value} / {percent(item.value, total)}%</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-brand"
              style={{ width: `${Math.max(8, (item.value / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function DonutChart({ items, total }: { items: Array<{ label: string; value: number }>; total: number }) {
  const colors = ["#2da6bd", "#f3cf69", "#263147", "#d8d0c2"];
  const gradients = items
    .reduce(
      (acc, item, index) => {
        const start = acc.offset;
        const width = total ? (item.value / total) * 100 : 0;
        acc.parts.push(`${colors[index % colors.length]} ${start}% ${start + width}%`);
        acc.offset += width;
        return acc;
      },
      { offset: 0, parts: [] as string[] }
    )
    .parts.join(", ");

  return (
    <div className="grid gap-5 sm:grid-cols-[180px_1fr] sm:items-center">
      <div
        className="mx-auto flex h-44 w-44 items-center justify-center rounded-full shadow-inner ring-1 ring-foreground/10"
        style={{ background: total ? `conic-gradient(${gradients})` : "hsl(var(--muted))" }}
      >
        <div className="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-white text-center shadow-sm">
          <span className="text-2xl font-black">{total}</span>
          <span className="text-xs font-bold text-muted-foreground">videos</span>
        </div>
      </div>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={item.label} className="flex items-center justify-between gap-3 rounded-md bg-muted/55 px-3 py-2 text-sm font-black">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: colors[index % colors.length] }} />
              {item.label}
            </span>
            <span className="text-muted-foreground">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DensityList({ videos }: { videos: Array<VideoPublic & { density: number }> }) {
  if (!videos.length) return <EmptyChart label="No subtitle data yet" />;
  const max = Math.max(...videos.map((video) => video.density), 1);

  return (
    <div className="space-y-3">
      {videos.map((video, index) => (
        <PendingLink
          key={video.id}
          href={`/videos/${video.id}`}
          className="block rounded-lg border border-foreground/10 bg-muted/35 p-3 transition-all hover:-translate-y-0.5 hover:bg-white hover:shadow-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-black">{index + 1}. {video.title}</p>
              <p className="mt-1 text-xs font-bold text-muted-foreground">
                {video.subtitle_count} lines / {formatDuration(video.duration)}
              </p>
            </div>
            <span className="shrink-0 rounded-md bg-white px-2 py-1 text-xs font-black text-brand shadow-sm">
              {video.density.toFixed(1)}/min
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
            <div className="h-full rounded-full bg-secondary" style={{ width: `${Math.max(8, (video.density / max) * 100)}%` }} />
          </div>
        </PendingLink>
      ))}
    </div>
  );
}

function TrendBars({ items }: { items: Array<{ label: string; value: number }> }) {
  if (!items.length) return <EmptyChart label="No publish dates yet" />;
  const max = Math.max(...items.map((item) => item.value), 1);

  return (
    <div className="flex h-64 items-end gap-3 rounded-lg bg-muted/35 p-4">
      {items.map((item) => (
        <div key={item.label} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-2 text-center">
          <div
            className={cn("mx-auto w-full rounded-t-md bg-brand shadow-sm", item.value === max && "bg-secondary")}
            style={{ height: `${Math.max(10, (item.value / max) * 100)}%` }}
          />
          <span className="text-xs font-black text-foreground">{item.value}</span>
          <span className="truncate text-[11px] font-bold text-muted-foreground">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-foreground/14 bg-muted/35 px-4 py-12 text-center text-sm font-bold text-muted-foreground">
      {label}
    </div>
  );
}
