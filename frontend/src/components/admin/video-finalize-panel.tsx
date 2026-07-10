"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Captions, Loader2, Rocket, Save, Trash2, UploadCloud, Wand2 } from "lucide-react";

import { FileDropField } from "@/components/file-drop-field";
import { PendingLink } from "@/components/pending-link";
import { VideoCover } from "@/components/video-cover";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Textarea } from "@/components/ui/textarea";
import { api, uploadWithProgress } from "@/lib/api";
import type { ProcessingTask, TaskCreated, VideoAdmin, VideoStatus, VideoTrack } from "@/lib/types";

type TagOption = {
  id: number;
  name: string;
};

function normalizeTagName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function VideoFinalizePanel({ videoId, onDeleted }: { videoId: number; onDeleted?: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagSelectValue, setTagSelectValue] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPending, setCoverPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [primaryTrackId, setPrimaryTrackId] = useState("");
  const [audioTrackId, setAudioTrackId] = useState("");
  const [subtitleTaskId, setSubtitleTaskId] = useState<number | null>(null);
  const [autoSubtitleStarted, setAutoSubtitleStarted] = useState(false);
  const autoSubtitleStartedRef = useRef(false);

  const { data: video, isLoading } = useQuery({
    queryKey: ["admin-video", videoId],
    queryFn: () => api.get<VideoAdmin>(`/api/admin/videos/${videoId}`),
  });

  const { data: tracks, isLoading: tracksLoading } = useQuery({
    queryKey: ["admin-video-tracks", videoId],
    queryFn: () => api.get<VideoTrack[]>(`/api/admin/videos/${videoId}/tracks`),
  });

  const { data: tagOptions } = useQuery({
    queryKey: ["admin-tags"],
    queryFn: () => api.get<TagOption[]>("/api/admin/tags"),
  });

  useEffect(() => {
    autoSubtitleStartedRef.current = false;
    setAutoSubtitleStarted(false);
    setSubtitleTaskId(null);
  }, [videoId]);

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
    if (!video) return;
    setTitle(video.title);
    setDescription(video.description ?? "");
    setSelectedTags(video.tags?.length ? video.tags : video.category ? [video.category] : []);
  }, [video]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-video", videoId] });
    void queryClient.invalidateQueries({ queryKey: ["admin-video-tracks", videoId] });
    void queryClient.invalidateQueries({ queryKey: ["admin-videos"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
  };

  useEffect(() => {
    const task = taskQuery.data;
    if (task?.status === "completed") {
      setMessage("字幕已准备好，可以进入预览编辑。");
      invalidate();
    }
    if (task?.status === "failed") {
      setMessage(task.error_message || "字幕处理失败。");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskQuery.data]);

  const infoMutation = useMutation({
    mutationFn: () => {
      if (selectedTags.length > 4) throw new Error("一个视频最多只能设置 4 个标签。");
      if (!title.trim()) throw new Error("请填写标题。");
      return api.put<VideoAdmin>(`/api/admin/videos/${videoId}`, {
        title: title.trim(),
        description,
        tags: selectedTags,
      });
    },
    onSuccess: () => {
      setMessage("视频信息已保存。");
      invalidate();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : "保存失败。"),
  });

  const publishMutation = useMutation({
    mutationFn: (status: VideoStatus) => api.put<VideoAdmin>(`/api/admin/videos/${videoId}`, { status }),
    onSuccess: () => {
      setMessage("发布状态已更新。");
      invalidate();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : "发布失败。"),
  });

  const unpublishMutation = useMutation({
    mutationFn: () => api.put<VideoAdmin>(`/api/admin/videos/${videoId}`, { status: "unpublished" }),
    onSuccess: () => {
      setMessage("视频已下架。");
      invalidate();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : "下架失败。"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/admin/videos/${videoId}`),
    onSuccess: () => {
      setConfirmDeleteOpen(false);
      onDeleted?.();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : "删除失败。"),
  });

  function addTag(rawName: string) {
    const name = normalizeTagName(rawName);
    if (!name) return;
    setSelectedTags((prev) => {
      if (prev.some((tag) => tag.toLowerCase() === name.toLowerCase())) return prev;
      if (prev.length >= 4) {
        setMessage("一个视频最多只能设置 4 个标签。");
        return prev;
      }
      return [...prev, name];
    });
    setTagSelectValue("");
    setNewTagName("");
  }

  function removeTag(name: string) {
    setSelectedTags((prev) => prev.filter((tag) => tag !== name));
  }

  async function saveCover() {
    if (!coverFile) return;
    setCoverPending(true);
    setMessage(null);
    try {
      const fd = new FormData();
      fd.set("cover_file", coverFile);
      await uploadWithProgress(`/api/admin/videos/${videoId}/cover`, fd, () => {});
      setCoverFile(null);
      setMessage("封面已更新。");
      invalidate();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "封面上传失败。");
    } finally {
      setCoverPending(false);
    }
  }

  async function extractSubtitleTrack() {
    const selectedTrackId = primaryTrackId || subtitleTracks[0]?.id;
    if (!selectedTrackId) {
      setMessage("没有可提取的字幕轨。");
      return;
    }
    setMessage(null);
    const res = await api.post<TaskCreated>(`/api/admin/videos/${videoId}/subtitles/extract`, {
      primary_track_id: Number(selectedTrackId),
      zh_track_id: null,
    });
    if (res.task_id > 0) {
      setSubtitleTaskId(res.task_id);
    } else {
      setMessage("字幕已准备好。");
      invalidate();
    }
  }

  async function generateSubtitles() {
    setMessage(null);
    const res = await api.post<TaskCreated>(`/api/admin/videos/${videoId}/subtitles/transcribe`, {
      audio_track_id: audioTrackId ? Number(audioTrackId) : null,
      language: null,
      split_enabled: true,
    });
    if (res.task_id > 0) {
      setSubtitleTaskId(res.task_id);
    } else {
      setAutoSubtitleStarted(false);
      setMessage("字幕已准备好。");
      invalidate();
    }
  }

  async function generateFromAudioTrack(trackId: number | null) {
    setMessage("正在使用音频轨自动生成学习字幕。");
    const res = await api.post<TaskCreated>(`/api/admin/videos/${videoId}/subtitles/transcribe`, {
      audio_track_id: trackId,
      language: null,
      split_enabled: true,
    });
    if (res.task_id > 0) {
      setSubtitleTaskId(res.task_id);
    } else {
      setAutoSubtitleStarted(false);
      setMessage("字幕已准备好。");
      invalidate();
    }
  }

  const subtitleTracks = (tracks ?? []).filter((track) => track.track_type === "subtitle");
  const audioTracks = (tracks ?? []).filter((track) => track.track_type === "audio");
  const activeTask = taskQuery.data;
  const subtitleTaskPending = activeTask?.status === "queued" || activeTask?.status === "running";
  const videoProcessing = video?.status === "processing";
  const needsAutoAudioSubtitle =
    !tracksLoading &&
    Boolean(video) &&
    (video?.subtitle_count ?? 0) <= 0 &&
    subtitleTracks.length === 0 &&
    audioTracks.length > 0 &&
    !subtitleTaskId &&
    !videoProcessing &&
    !autoSubtitleStarted &&
    !autoSubtitleStartedRef.current;

  useEffect(() => {
    if (!needsAutoAudioSubtitle) return;
    const firstAudioTrack = audioTracks[0];
    autoSubtitleStartedRef.current = true;
    setAutoSubtitleStarted(true);
    setAudioTrackId(String(firstAudioTrack.id));
    void generateFromAudioTrack(firstAudioTrack.id).catch((err) => {
      setMessage(err instanceof Error ? err.message : "自动生成字幕失败。");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsAutoAudioSubtitle]);

  if (isLoading || !video) {
    return (
      <div className="grid gap-5 xl:grid-cols-[22rem_minmax(0,1fr)_27rem]">
        <Skeleton className="h-80 rounded-lg" />
        <Skeleton className="h-80 rounded-lg" />
        <Skeleton className="h-80 rounded-lg" />
      </div>
    );
  }

  const canPublish = video.subtitle_count > 0 && video.status !== "processing" && video.status !== "failed";
  const isPublished = video.status === "published";
  const publishDisabled = !canPublish || publishMutation.isPending || tracksLoading || subtitleTaskPending || videoProcessing;
  const publishLabel = canPublish
    ? publishMutation.isPending
      ? "发布中..."
      : "发布视频"
    : subtitleTaskPending || videoProcessing
      ? "字幕生成后可发布"
      : "发布视频";

  const availableTags = (tagOptions ?? []).filter(
    (tag) => !selectedTags.some((selected) => selected.toLowerCase() === tag.name.toLowerCase())
  );

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5">
      {message && <div className="rounded-lg border border-foreground/10 bg-white px-4 py-3 text-sm font-bold shadow-sm">{message}</div>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="surface bg-white p-5">
          <div className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <div className="space-y-4">
              <h2 className="text-xl font-black">封面</h2>
              <VideoCover src={video.cover_url} alt={video.title} className="rounded-lg border border-foreground/10" />
              <FileDropField label="替换封面" accept=".jpg,.jpeg,.png,.webp" hint="支持 jpg / png / webp" file={coverFile} onChange={setCoverFile} />
              <Button size="sm" variant="outline" onClick={saveCover} disabled={!coverFile || coverPending}>
                <UploadCloud />
                {coverPending ? "上传中..." : "保存封面"}
              </Button>
            </div>

            <div className="max-w-2xl space-y-4">
              <h2 className="text-xl font-black">视频信息</h2>
              <div className="space-y-2">
                <Label htmlFor="final-title">标题</Label>
                <Input id="final-title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>标签（最多 4 个）</Label>
                <div className="flex min-h-10 flex-wrap gap-2 rounded-md border border-foreground/10 bg-muted/20 p-2">
                  {selectedTags.length > 0 ? (
                    selectedTags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className="rounded-full bg-brand/15 px-3 py-1 text-xs font-black text-brand hover:bg-brand/25"
                        onClick={() => removeTag(tag)}
                        title="点击移除"
                      >
                        {tag} ×
                      </button>
                    ))
                  ) : (
                    <span className="px-1 py-1 text-xs font-bold text-muted-foreground">还没有标签</span>
                  )}
                </div>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <select
                    className="h-10 rounded-md border border-foreground/15 bg-white px-3 text-sm font-semibold"
                    value={tagSelectValue}
                    onChange={(event) => {
                      setTagSelectValue(event.target.value);
                      addTag(event.target.value);
                    }}
                    disabled={selectedTags.length >= 4}
                  >
                    <option value="">选择已有标签</option>
                    {availableTags.map((tag) => (
                      <option key={tag.id} value={tag.name}>
                        {tag.name}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <Input
                      value={newTagName}
                      onChange={(event) => setNewTagName(event.target.value)}
                      placeholder="新建标签"
                      disabled={selectedTags.length >= 4}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addTag(newTagName);
                        }
                      }}
                    />
                    <Button type="button" variant="outline" onClick={() => addTag(newTagName)} disabled={!normalizeTagName(newTagName) || selectedTags.length >= 4}>
                      添加
                    </Button>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="final-description">说明</Label>
                <Textarea id="final-description" rows={6} value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
            </div>
          </div>
        </section>

        <aside className="surface bg-white p-5">
          <h2 className="text-xl font-black">字幕与发布</h2>
          <div className="mt-4 rounded-lg border border-foreground/10 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-black">字幕轨道</h2>
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-black text-muted-foreground">
                {tracksLoading ? "检测中" : `已检测 ${subtitleTracks.length} 条`}
              </span>
            </div>
            {tracksLoading ? (
              <div className="mt-3 space-y-2">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-2/3" />
              </div>
            ) : subtitleTracks.length > 0 ? (
              <div className="mt-3 space-y-3">
                <select
                  className="h-10 w-full rounded-md border-2 border-foreground bg-white px-3 text-sm font-semibold"
                  value={primaryTrackId}
                  onChange={(e) => setPrimaryTrackId(e.target.value)}
                >
                  <option value="">自动选择第一个字幕轨</option>
                  {subtitleTracks.map((track) => (
                    <option key={track.id} value={track.id}>
                      #{track.stream_index} {track.language || "und"} {track.codec || "subtitle"}
                    </option>
                  ))}
                </select>
                <Button size="sm" variant="brand" onClick={extractSubtitleTrack} disabled={subtitleTaskPending}>
                  {subtitleTaskPending ? <Loader2 className="animate-spin" /> : <Captions />}
                  提取字幕轨并生成学习字幕
                </Button>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <p className="text-sm font-semibold text-muted-foreground">
                  没有检测到内嵌字幕轨。系统会自动使用音频轨生成学习字幕，生成后即可预览编辑。
                </p>
                <select
                  className="h-10 w-full rounded-md border-2 border-foreground bg-white px-3 text-sm font-semibold"
                  value={audioTrackId}
                  onChange={(e) => setAudioTrackId(e.target.value)}
                  disabled={subtitleTaskPending || videoProcessing || autoSubtitleStarted}
                >
                  <option value="">自动选择音频轨</option>
                  {audioTracks.map((track) => (
                    <option key={track.id} value={track.id}>
                      #{track.stream_index} {track.language || "und"} {track.codec || "audio"}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="brand"
                  onClick={generateSubtitles}
                  disabled={subtitleTaskPending || videoProcessing || autoSubtitleStarted || audioTracks.length === 0}
                >
                  {subtitleTaskPending ? <Loader2 className="animate-spin" /> : <Wand2 />}
                  {subtitleTaskPending || videoProcessing || autoSubtitleStarted ? "正在生成字幕" : "重新生成字幕"}
                </Button>
              </div>
            )}
            {activeTask && (
              <div className="mt-3 space-y-2">
                <div className="flex justify-between text-xs font-bold text-muted-foreground">
                  <span>{activeTask.status === "failed" ? "处理失败" : activeTask.status === "completed" ? "处理完成" : "字幕处理中"}</span>
                  <span>{activeTask.progress}%</span>
                </div>
                <ProgressBar value={activeTask.progress} />
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <Button variant="brand" asChild>
              <PendingLink href={`/admin/videos/${video.id}/subtitles`}>
                <Captions />
                预览和编辑字幕轨道
              </PendingLink>
            </Button>
          </div>

          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => infoMutation.mutate()} disabled={infoMutation.isPending}>
                <Save />
                {infoMutation.isPending ? "保存中..." : "保存信息"}
              </Button>
              {isPublished ? (
                <Button variant="outline" asChild>
                  <PendingLink href={`/videos/${video.id}`}>前台查看</PendingLink>
                </Button>
              ) : (
                <Button
                  variant="brand"
                  disabled={publishDisabled}
                  onClick={() => publishMutation.mutate("published")}
                  title={!canPublish ? "发布前需要先准备好字幕" : undefined}
                >
                  {subtitleTaskPending || videoProcessing ? <Loader2 className="animate-spin" /> : <Rocket />}
                  {publishLabel}
                </Button>
              )}
            </div>

            {!canPublish && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900">
                {subtitleTaskPending || videoProcessing || autoSubtitleStarted
                  ? "正在从音频轨生成学习字幕。生成完成后这里会自动刷新，发布按钮会变为可用。"
                  : "视频和轨道检测已完成，但还没有可发布的学习字幕。系统会优先使用音频轨自动生成。"}
              </div>
            )}
          </div>

          <div className="mt-5 border-t border-foreground/10 pt-4">
            <h3 className="text-sm font-black text-muted-foreground">更多操作</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {isPublished && (
                <Button variant="outline" size="sm" onClick={() => unpublishMutation.mutate()} disabled={unpublishMutation.isPending}>
                  {unpublishMutation.isPending ? "下架中..." : "下架视频"}
                </Button>
              )}
              {onDeleted && (
                <Button variant="destructive" size="sm" onClick={() => setConfirmDeleteOpen(true)}>
                  <Trash2 />
                  删除视频
                </Button>
              )}
            </div>
          </div>
        </aside>
      </div>

      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除视频</DialogTitle>
            <DialogDescription>
              确定删除“{video.title}”吗？视频文件、封面、字幕和学习进度都会被永久删除，无法恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
              {deleteMutation.isPending ? "删除中..." : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
