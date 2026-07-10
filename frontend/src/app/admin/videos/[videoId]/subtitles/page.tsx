"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Captions, Loader2, LogOut, Save, Wand2 } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { useNavigationFeedback } from "@/components/navigation-feedback";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { AdminSubtitles, ProcessingTask, Subtitle, TaskCreated, VideoAdmin, VideoTrack } from "@/lib/types";
import { cn, formatMs } from "@/lib/utils";

type EditableSubtitle = {
  id: number | null;
  start_ms: number;
  end_ms: number;
  en_text: string;
  zh_text: string;
  sort_order: number;
};

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

function findIndexAt(currentMs: number, subtitles: EditableSubtitle[]) {
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

function seconds(ms: number) {
  return Number((ms / 1000).toFixed(2));
}

function msFromSeconds(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 1000)) : 0;
}

export default function AdminSubtitlesPage() {
  const params = useParams<{ videoId: string }>();
  const videoId = Number(params.videoId);
  const router = useRouter();
  const navigation = useNavigationFeedback();
  const queryClient = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const currentIndexRef = useRef(-1);
  const [rows, setRows] = useState<EditableSubtitle[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [dirty, setDirty] = useState(false);
  const [confirmExitOpen, setConfirmExitOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [subtitleTaskId, setSubtitleTaskId] = useState<number | null>(null);

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

  const { data: tracks } = useQuery({
    queryKey: ["admin-video-tracks", videoId],
    queryFn: () => api.get<VideoTrack[]>(`/api/admin/videos/${videoId}/tracks`),
    enabled: Number.isFinite(videoId),
  });

  const taskQuery = useQuery({
    queryKey: ["admin-task", subtitleTaskId],
    queryFn: () => api.get<ProcessingTask>(`/api/admin/tasks/${subtitleTaskId}`),
    enabled: subtitleTaskId != null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "completed" || status === "failed" ? false : 1500;
    },
  });

  useEffect(() => {
    if (!data?.subtitles) return;
    setRows(toEditable(data.subtitles));
    setDirty(false);
  }, [data?.subtitles]);

  useEffect(() => {
    const task = taskQuery.data;
    if (task?.status === "completed") {
      setMessage("字幕已生成，正在刷新列表。");
      void queryClient.invalidateQueries({ queryKey: ["admin-video", videoId] });
      void queryClient.invalidateQueries({ queryKey: ["admin-videos"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-subtitles", videoId] });
    }
    if (task?.status === "failed") {
      setMessage(task.error_message || "字幕处理失败。");
    }
  }, [queryClient, taskQuery.data, videoId]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

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
      setDirty(false);
      setMessage("字幕已保存。");
      void queryClient.invalidateQueries({ queryKey: ["admin-video", videoId] });
      void queryClient.invalidateQueries({ queryKey: ["admin-videos"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-subtitles", videoId] });
    },
    onError: (err) => setMessage(err instanceof Error ? err.message : "保存失败。"),
  });

  function updateRow(index: number, patch: Partial<EditableSubtitle>) {
    setRows((prev) => prev.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
    setDirty(true);
  }

  function seekTo(row: EditableSubtitle) {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = row.start_ms / 1000 + 0.001;
    void el.play();
  }

  async function saveAndExit() {
    try {
      await saveMutation.mutateAsync();
      navigation.start();
      router.push(`/admin/videos/${videoId}/edit`);
    } catch {
      // onError already shows the message.
    }
  }

  function requestExit() {
    if (dirty) setConfirmExitOpen(true);
    else {
      navigation.start();
      router.push(`/admin/videos/${videoId}/edit`);
    }
  }

  async function extractFirstSubtitleTrack() {
    const firstTrack = subtitleTracks[0];
    if (!firstTrack) {
      setMessage("没有可提取的字幕轨。");
      return;
    }
    setMessage(null);
    const res = await api.post<TaskCreated>(`/api/admin/videos/${videoId}/subtitles/extract`, {
      primary_track_id: firstTrack.id,
      zh_track_id: null,
    });
    setSubtitleTaskId(res.task_id);
  }

  async function generateSubtitles() {
    setMessage(null);
    const res = await api.post<TaskCreated>(`/api/admin/videos/${videoId}/subtitles/transcribe`, {
      audio_track_id: null,
      language: null,
      split_enabled: true,
    });
    setSubtitleTaskId(res.task_id);
  }

  const currentSubtitle = currentIndex >= 0 ? rows[currentIndex] : null;
  const subtitleTracks = (tracks ?? []).filter((track) => track.track_type === "subtitle");
  const audioTracks = (tracks ?? []).filter((track) => track.track_type === "audio");
  const activeTask = taskQuery.data;
  const subtitleTaskPending = activeTask?.status === "queued" || activeTask?.status === "running";

  return (
    <div className="w-full max-w-none space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" onClick={requestExit} aria-label="返回最终确认页">
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-3xl font-black tracking-normal">
            字幕轨道编辑{video ? ` · ${video.title}` : ""}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-muted-foreground">
            {video && <StatusBadge status={video.status} />}
            <span>预览视频、校对时间轴和字幕文本。保存后返回最后发布步骤。</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || rows.length === 0}>
            <Save />
            {saveMutation.isPending ? "保存中..." : "保存"}
          </Button>
          <Button variant="brand" onClick={saveAndExit} disabled={saveMutation.isPending || rows.length === 0}>
            <Save />
            保存退出
          </Button>
          <Button variant="outline" onClick={requestExit}>
            <LogOut />
            退出
          </Button>
        </div>
      </div>

      {message && <div className="rounded-lg border border-foreground/10 bg-white px-4 py-3 text-sm font-bold shadow-sm">{message}</div>}

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

      <div className="grid min-h-[74vh] gap-5 xl:grid-cols-[minmax(0,1fr)_42rem]">
        <section className="surface bg-white p-4">
          <div className="sticky top-24 overflow-hidden rounded-lg border-2 border-foreground bg-black shadow-soft">
            {video?.file_url ? (
              <div className="relative">
                <video ref={videoRef} src={video.file_url} controls className="aspect-video w-full bg-black object-contain" />
                {currentSubtitle?.en_text && (
                  <div className="pointer-events-none absolute bottom-12 left-1/2 max-w-[82%] -translate-x-1/2 rounded-md bg-black/70 px-4 py-2 text-center text-sm font-bold text-white shadow-soft">
                    {currentSubtitle.en_text}
                    {currentSubtitle.zh_text && <div className="mt-1 text-xs text-white/85">{currentSubtitle.zh_text}</div>}
                  </div>
                )}
              </div>
            ) : (
              <Skeleton className="aspect-video w-full" />
            )}
          </div>
        </section>

        <section className="surface bg-white p-3">
          <div className="flex items-center justify-between gap-3 px-2 py-2">
            <h2 className="text-xl font-black">字幕列表（{rows.length} 句）</h2>
            {dirty && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-900">有未保存修改</span>}
          </div>

          {isLoading ? (
            <div className="space-y-3 p-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-28 w-full rounded-lg" />
              ))}
            </div>
          ) : rows.length > 0 ? (
            <div className="thin-scrollbar max-h-[70vh] space-y-3 overflow-auto p-2">
              {rows.map((row, index) => (
                <article
                  key={`${row.id ?? "new"}-${index}`}
                  className={cn(
                    "grid gap-3 rounded-lg border p-3 text-sm transition-colors sm:grid-cols-[4.5rem_minmax(0,1fr)]",
                    index === currentIndex ? "border-brand bg-brand/10" : "border-foreground/10 bg-white hover:bg-muted/30"
                  )}
                >
                  <button type="button" className="text-left font-mono text-xs font-bold text-muted-foreground" onClick={() => seekTo(row)}>
                    <span className="block text-foreground">#{index + 1}</span>
                    <span>{formatMs(row.start_ms)}</span>
                    <span className="block">{formatMs(row.end_ms)}</span>
                  </button>
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <Input
                        type="number"
                        step="0.01"
                        value={seconds(row.start_ms)}
                        onChange={(e) => updateRow(index, { start_ms: msFromSeconds(e.target.value) })}
                        className="h-8 w-24 font-mono"
                      />
                      <Input
                        type="number"
                        step="0.01"
                        value={seconds(row.end_ms)}
                        onChange={(e) => updateRow(index, { end_ms: msFromSeconds(e.target.value) })}
                        className="h-8 w-24 font-mono"
                      />
                    </div>
                    <Textarea value={row.en_text} onChange={(e) => updateRow(index, { en_text: e.target.value })} rows={2} />
                    <Textarea value={row.zh_text} onChange={(e) => updateRow(index, { zh_text: e.target.value })} rows={1} placeholder="中文字幕，可选" />
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="m-2 space-y-4 rounded-lg border border-foreground/10 bg-muted/30 px-4 py-12 text-center text-sm font-bold text-muted-foreground">
              <p>暂无字幕。可以直接在这里调用接口提取字幕轨或自动生成字幕。</p>
              <div className="flex flex-wrap justify-center gap-2">
                {subtitleTracks.length > 0 && (
                  <Button variant="brand" onClick={extractFirstSubtitleTrack} disabled={subtitleTaskPending}>
                    {subtitleTaskPending ? <Loader2 className="animate-spin" /> : <Captions />}
                    提取字幕轨
                  </Button>
                )}
                <Button variant="brand" onClick={generateSubtitles} disabled={subtitleTaskPending || audioTracks.length === 0}>
                  {subtitleTaskPending ? <Loader2 className="animate-spin" /> : <Wand2 />}
                  自动生成字幕
                </Button>
              </div>
              {audioTracks.length === 0 && subtitleTracks.length === 0 && <p className="text-xs">暂未检测到可用音频轨或字幕轨。</p>}
              {activeTask && (
                <div className="mx-auto max-w-sm space-y-2 text-left">
                  <div className="flex justify-between text-xs font-bold text-muted-foreground">
                    <span>{activeTask.status === "failed" ? "处理失败" : activeTask.status === "completed" ? "处理完成" : "字幕处理中"}</span>
                    <span>{activeTask.progress}%</span>
                  </div>
                  <ProgressBar value={activeTask.progress} />
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <Dialog open={confirmExitOpen} onOpenChange={setConfirmExitOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>退出字幕编辑？</DialogTitle>
            <DialogDescription>
              当前字幕有未保存修改。直接退出会丢失这些修改。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmExitOpen(false)}>
              继续编辑
            </Button>
            <Button variant="brand" disabled={saveMutation.isPending || rows.length === 0} onClick={saveAndExit}>
              保存退出
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                navigation.start();
                router.push(`/admin/videos/${videoId}/edit`);
              }}
            >
              不保存退出
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
