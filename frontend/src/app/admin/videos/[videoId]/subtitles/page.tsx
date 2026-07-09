"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Save } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { AdminSubtitles, Subtitle, VideoAdmin } from "@/lib/types";
import { cn, formatMs } from "@/lib/utils";

type EditableSubtitle = {
  id: number | null;
  start_ms: number;
  end_ms: number;
  en_text: string;
  zh_text: string;
  sort_order: number;
};

function findIndexAt(currentMs: number, subtitles: EditableSubtitle[]): number {
  let left = 0;
  let right = subtitles.length - 1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const item = subtitles[mid];
    if (currentMs < item.start_ms) right = mid - 1;
    else if (currentMs >= item.end_ms) left = mid + 1;
    else return mid;
  }
  return -1;
}

function toEditable(subtitles: Subtitle[]): EditableSubtitle[] {
  return subtitles.map((item) => ({
    id: item.id,
    start_ms: item.start_ms,
    end_ms: item.end_ms,
    en_text: item.en_text ?? "",
    zh_text: item.zh_text ?? "",
    sort_order: item.sort_order,
  }));
}

export default function AdminSubtitlesPage() {
  const params = useParams<{ videoId: string }>();
  const videoId = Number(params.videoId);
  const videoRef = useRef<HTMLVideoElement>(null);
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<EditableSubtitle[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [message, setMessage] = useState<string | null>(null);
  const currentIndexRef = useRef(-1);

  const { data: video } = useQuery({
    queryKey: ["admin-video", videoId],
    queryFn: () => api.get<VideoAdmin>(`/api/admin/videos/${videoId}`),
    enabled: Number.isFinite(videoId),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["admin-subtitles", videoId],
    queryFn: () => api.get<AdminSubtitles>(`/api/admin/videos/${videoId}/subtitles`),
    enabled: Number.isFinite(videoId),
  });

  useEffect(() => {
    if (data?.subtitles) setRows(toEditable(data.subtitles));
  }, [data?.subtitles]);

  useEffect(() => {
    if (rows.length === 0) return;
    let rafId: number;
    const sync = () => {
      const el = videoRef.current;
      if (el) {
        const idx = findIndexAt(Math.floor(el.currentTime * 1000), rows);
        if (idx !== currentIndexRef.current) {
          currentIndexRef.current = idx;
          setCurrentIndex(idx);
        }
      }
      rafId = requestAnimationFrame(sync);
    };
    rafId = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(rafId);
  }, [rows]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put<AdminSubtitles>(`/api/admin/videos/${videoId}/subtitles`, {
        subtitles: rows.map((row, index) => ({
          ...row,
          sort_order: index,
          en_text: row.en_text.trim() || null,
          zh_text: row.zh_text.trim() || null,
        })),
      }),
    onSuccess: (res) => {
      setRows(toEditable(res.subtitles));
      setMessage("已保存。");
      void queryClient.invalidateQueries({ queryKey: ["admin-video", videoId] });
      void queryClient.invalidateQueries({ queryKey: ["admin-videos"] });
    },
    onError: (err) => setMessage(err instanceof Error ? err.message : "保存失败。"),
  });

  function updateRow(index: number, patch: Partial<EditableSubtitle>) {
    setRows((prev) => prev.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function seekTo(row: EditableSubtitle) {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = row.start_ms / 1000 + 0.001;
    void el.play();
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/admin/videos/${videoId}/edit`} aria-label="返回编辑页">
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-3xl font-bold tracking-normal">
            字幕编辑{video ? ` · ${video.title}` : ""}
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-muted-foreground">
            {video && <StatusBadge status={video.status} />}
            <span>点击序号可跳转预览；修改时间轴、英文或中文后保存，前台学习页会立即使用新版字幕。</span>
          </p>
        </div>
        <Button variant="brand" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || rows.length === 0}>
          <Save className="h-4 w-4" />
          {saveMutation.isPending ? "保存中..." : "保存字幕"}
        </Button>
      </div>

      {message && <div className="rounded-md border-2 border-foreground bg-white px-4 py-3 text-sm font-bold">{message}</div>}

      {data && data.warnings.length > 0 && (
        <Card className="border-amber-700 bg-amber-50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-xl text-amber-900">
              <AlertTriangle className="h-5 w-5" />
              解析警告（{data.warnings.length}）
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm font-bold text-amber-900">
            {data.warnings.map((warning) => (
              <p key={warning.id}>- {warning.message}</p>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(320px,1fr)]">
        <Card className="order-2 bg-white lg:order-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-xl">字幕列表（{rows.length} 句）</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : rows.length > 0 ? (
              <div className="thin-scrollbar max-h-[72vh] overflow-auto p-3">
                <table className="w-full min-w-[900px] overflow-hidden rounded-md border-2 border-foreground bg-white text-sm shadow-soft">
                  <thead className="sticky top-0 bg-accent text-xs text-foreground">
                    <tr className="border-b-2 border-foreground">
                      <th className="w-14 px-3 py-2 text-left font-mono font-bold">#</th>
                      <th className="w-36 px-3 py-2 text-left font-mono font-bold">开始 ms</th>
                      <th className="w-36 px-3 py-2 text-left font-mono font-bold">结束 ms</th>
                      <th className="px-3 py-2 text-left font-bold">英文</th>
                      <th className="px-3 py-2 text-left font-bold">中文</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr
                        key={`${row.id ?? "new"}-${index}`}
                        className={cn(
                          "border-b-2 border-foreground/15 align-top transition-colors",
                          index === currentIndex ? "bg-accent/70" : "hover:bg-accent/30"
                        )}
                      >
                        <td className="px-3 py-3 font-mono text-muted-foreground">
                          <button type="button" className="font-bold underline" onClick={() => seekTo(row)}>
                            {index + 1}
                          </button>
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            value={row.start_ms}
                            onChange={(e) => updateRow(index, { start_ms: Number(e.target.value) })}
                            className="font-mono"
                          />
                          <span className="mt-1 block text-[11px] font-mono text-muted-foreground">{formatMs(row.start_ms)}</span>
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            value={row.end_ms}
                            onChange={(e) => updateRow(index, { end_ms: Number(e.target.value) })}
                            className="font-mono"
                          />
                          <span className="mt-1 block text-[11px] font-mono text-muted-foreground">{formatMs(row.end_ms)}</span>
                        </td>
                        <td className="px-3 py-2">
                          <Textarea value={row.en_text} onChange={(e) => updateRow(index, { en_text: e.target.value })} rows={2} />
                        </td>
                        <td className="px-3 py-2">
                          <Textarea value={row.zh_text} onChange={(e) => updateRow(index, { zh_text: e.target.value })} rows={2} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="doodle-note m-4 rounded-md py-12 text-center text-sm font-bold text-foreground">
                暂无字幕。请回到编辑页上传字幕、提取视频字幕轨，或使用 Whisper 生成字幕。
              </p>
            )}
          </CardContent>
        </Card>

        <div className="order-1 lg:order-2">
          <div className="sticky top-6 overflow-hidden rounded-lg border-2 border-foreground bg-secondary shadow-soft">
            {video?.file_url ? (
              <video ref={videoRef} src={video.file_url} controls className="aspect-video w-full" />
            ) : (
              <Skeleton className="aspect-video w-full" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
