"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Captions, CheckCircle2, Eye, Rocket, XCircle } from "lucide-react";

import { FileDropField } from "@/components/file-drop-field";
import { StatusBadge } from "@/components/status-badge";
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
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, uploadWithProgress } from "@/lib/api";
import type { ProcessingTask, ReuploadResult, TaskCreated, VideoAdmin, VideoStatus, VideoTrack } from "@/lib/types";
import { formatDuration, formatFileSize } from "@/lib/utils";

function parseTagsInput(value: string) {
  const seen = new Set<string>();
  return value
    .split(/[,，、\n]/)
    .map((item) => item.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export default function AdminVideoEditPage() {
  const params = useParams<{ videoId: string }>();
  const videoId = Number(params.videoId);
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: video, isLoading } = useQuery({
    queryKey: ["admin-video", videoId],
    queryFn: () => api.get<VideoAdmin>(`/api/admin/videos/${videoId}`),
    enabled: Number.isFinite(videoId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-video", videoId] });
    void queryClient.invalidateQueries({ queryKey: ["admin-videos"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
  };

  if (isLoading || !video) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/videos" aria-label="返回视频列表">
            <ArrowLeft />
          </Link>
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
        <Button variant="outline" asChild>
          <Link href={`/admin/videos/${video.id}/subtitles`}>字幕预览</Link>
        </Button>
      </div>

      <PreviewPublishCard video={video} onChanged={invalidate} />
      <BasicInfoCard video={video} onSaved={invalidate} />
      <CoverCard video={video} onSaved={invalidate} />
      <SubtitleSourceCard video={video} onSaved={invalidate} />
      <DangerCard video={video} onChanged={invalidate} onDeleted={() => router.push("/admin/videos")} />
    </div>
  );
}

function PreviewPublishCard({ video, onChanged }: { video: VideoAdmin; onChanged: () => void }) {
  const [message, setMessage] = useState<string | null>(null);

  const publishMutation = useMutation({
    mutationFn: (newStatus: VideoStatus) => api.put(`/api/admin/videos/${video.id}`, { status: newStatus }),
    onSuccess: () => {
      setMessage("发布状态已更新。");
      onChanged();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : "发布失败"),
  });

  const canPublish = (video.status === "ready" || video.status === "unpublished") && video.subtitle_count > 0;
  const needsSubtitle = video.subtitle_count <= 0 || video.status === "needs_subtitle" || video.status === "failed";
  const tags = video.tags?.length ? video.tags : video.category ? [video.category] : [];

  return (
    <section className="surface bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="swiss-label text-brand">Final step</div>
          <h2 className="mt-1 text-2xl font-black">预览与发布</h2>
          <p className="mt-1 text-sm font-semibold text-muted-foreground">
            视频已经导入。先确认播放、封面、标题、说明和标签；字幕准备好后就可以发布到前台。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {video.subtitle_count > 0 ? (
            <Button size="sm" variant="outline" asChild>
              <Link href={`/admin/videos/${video.id}/subtitles`}>
                <Captions />
                检查字幕
              </Link>
            </Button>
          ) : (
            <Button size="sm" variant="outline" asChild>
              <Link href="#subtitle-source">
                <Captions />
                准备字幕
              </Link>
            </Button>
          )}
          {video.status === "published" ? (
            <Button size="sm" variant="outline" asChild>
              <Link href={`/videos/${video.id}`}>
                <Eye />
                前台查看
              </Link>
            </Button>
          ) : (
            <Button
              size="sm"
              variant="brand"
              disabled={!canPublish || publishMutation.isPending}
              onClick={() => publishMutation.mutate("published")}
              title={!canPublish ? "发布前需要先准备好字幕" : undefined}
            >
              <Rocket />
              {!canPublish ? "先准备字幕" : publishMutation.isPending ? "发布中..." : "发布视频"}
            </Button>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="overflow-hidden rounded-lg border-2 border-foreground bg-secondary shadow-soft">
          {video.file_url ? (
            <video src={video.file_url} controls className="aspect-video w-full bg-black" />
          ) : (
            <Skeleton className="aspect-video w-full" />
          )}
        </div>

        <div className="space-y-3">
          <div className="rounded-lg border border-foreground/10 bg-white/80 p-4">
            <h3 className="text-base font-black">{video.title}</h3>
            <p className="mt-2 line-clamp-3 text-sm font-semibold text-muted-foreground">
              {video.description || "还没有填写说明。可以在下方补充视频内容、学习水平或练习重点。"}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {tags.length > 0 ? (
                tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-muted px-2.5 py-1 text-xs font-black text-muted-foreground">
                    {tag}
                  </span>
                ))
              ) : (
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-black text-muted-foreground">未设置标签</span>
              )}
            </div>
          </div>

          <div className="grid gap-2 text-sm font-bold">
            <ChecklistItem done={Boolean(video.file_url)} label="视频文件已保存，可以预览播放" />
            <ChecklistItem done={Boolean(video.cover_url)} label={video.cover_url ? "封面已准备好" : "还没有封面，可在下方替换"} />
            <ChecklistItem done={video.title.trim().length > 0} label="标题已填写" />
            <ChecklistItem done={video.subtitle_count > 0} label={video.subtitle_count > 0 ? `字幕已准备好：${video.subtitle_count} 句` : "发布前需要准备字幕"} />
          </div>

          {needsSubtitle && (
            <div className="rounded-lg border-2 border-amber-600 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
              你可以先完善封面和信息，但发布前需要先准备字幕。往下到“字幕来源”可以选择字幕轨、上传字幕文件或自动生成字幕初稿。
            </div>
          )}
          {message && <p className="text-sm font-bold text-muted-foreground">{message}</p>}
        </div>
      </div>
    </section>
  );
}

function ChecklistItem({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2">
      {done ? <CheckCircle2 className="h-4 w-4 text-emerald-700" /> : <AlertTriangle className="h-4 w-4 text-amber-700" />}
      <span className={done ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </div>
  );
}

function BasicInfoCard({ video, onSaved }: { video: VideoAdmin; onSaved: () => void }) {
  const [title, setTitle] = useState(video.title);
  const [description, setDescription] = useState(video.description ?? "");
  const [tagsInput, setTagsInput] = useState((video.tags?.length ? video.tags : video.category ? [video.category] : []).join("，"));
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setTitle(video.title);
    setDescription(video.description ?? "");
    setTagsInput((video.tags?.length ? video.tags : video.category ? [video.category] : []).join("，"));
  }, [video]);

  const mutation = useMutation({
    mutationFn: () => {
      const tags = parseTagsInput(tagsInput);
      if (tags.length > 4) throw new Error("一个视频最多只能设置 4 个标签。");
      return api.put(`/api/admin/videos/${video.id}`, {
        title: title.trim(),
        description,
        tags,
      });
    },
    onSuccess: () => {
      setMessage("已保存");
      onSaved();
    },
    onError: (e) => setMessage(e instanceof Error ? e.message : "保存失败"),
  });

  return (
    <section className="surface bg-white p-6">
      <h2 className="text-2xl font-bold">基本信息</h2>
      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setMessage(null);
          mutation.mutate();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="title">标题</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tags">标签（最多 4 个）</Label>
          <Input
            id="tags"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="例如：A1入门，生活vlog，美食"
          />
          <p className="text-xs font-semibold text-muted-foreground">用逗号、顿号或换行分隔。</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="description">简介</Label>
          <Textarea id="description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="brand" disabled={mutation.isPending}>
            {mutation.isPending ? "保存中..." : "保存修改"}
          </Button>
          {message && <span className="text-sm font-bold text-muted-foreground">{message}</span>}
        </div>
      </form>
    </section>
  );
}

function CoverCard({ video, onSaved }: { video: VideoAdmin; onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function upload() {
    if (!file) return;
    setPending(true);
    setMessage(null);
    try {
      const fd = new FormData();
      fd.set("cover_file", file);
      await uploadWithProgress(`/api/admin/videos/${video.id}/cover`, fd, () => {});
      setMessage("封面已更新");
      setFile(null);
      onSaved();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "上传失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="surface bg-white p-6">
      <h2 className="text-2xl font-bold">封面</h2>
      <div className="mt-4 flex flex-wrap items-start gap-5">
        <VideoCover src={video.cover_url} alt={video.title} className="w-52 rounded-lg border-2 border-foreground shadow-soft" />
        <div className="min-w-52 flex-1 space-y-3">
          <FileDropField label="替换封面" accept=".jpg,.jpeg,.png,.webp" hint="支持 .jpg / .png / .webp" file={file} onChange={setFile} />
          <div className="flex items-center gap-3">
            <Button size="sm" variant="brand" onClick={upload} disabled={!file || pending}>
              {pending ? "上传中..." : "替换封面"}
            </Button>
            {message && <span className="text-sm font-bold text-muted-foreground">{message}</span>}
          </div>
        </div>
      </div>
    </section>
  );
}

function taskStatusLabel(status: string) {
  if (status === "queued") return "排队中";
  if (status === "running") return "处理中";
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  return status;
}

function SubtitleSourceCard({ video, onSaved }: { video: VideoAdmin; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const [primaryTrackId, setPrimaryTrackId] = useState("");
  const [zhTrackId, setZhTrackId] = useState("");
  const [audioTrackId, setAudioTrackId] = useState("");
  const [language, setLanguage] = useState("");
  const [taskId, setTaskId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [enFile, setEnFile] = useState<File | null>(null);
  const [zhFile, setZhFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPending, setUploadPending] = useState(false);
  const [uploadResult, setUploadResult] = useState<ReuploadResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const { data: tracks } = useQuery({
    queryKey: ["admin-video-tracks", video.id],
    queryFn: () => api.get<VideoTrack[]>(`/api/admin/videos/${video.id}/tracks`),
  });

  const taskQuery = useQuery({
    queryKey: ["admin-task", taskId],
    queryFn: () => api.get<ProcessingTask>(`/api/admin/tasks/${taskId}`),
    enabled: taskId != null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "completed" || status === "failed" ? false : 1500;
    },
  });

  useEffect(() => {
    const task = taskQuery.data;
    if (task?.status === "completed") {
      setMessage("处理完成，当前学习字幕已更新。");
      void queryClient.invalidateQueries({ queryKey: ["admin-video", video.id] });
      void queryClient.invalidateQueries({ queryKey: ["admin-subtitles", video.id] });
      void queryClient.invalidateQueries({ queryKey: ["admin-videos"] });
      onSaved();
    }
    if (task?.status === "failed") {
      setMessage(task.error_message || "处理失败。");
    }
  }, [onSaved, queryClient, taskQuery.data, video.id]);

  const subtitleTracks = (tracks ?? []).filter((track) => track.track_type === "subtitle");
  const audioTracks = (tracks ?? []).filter((track) => track.track_type === "audio");
  const activeTask = taskQuery.data;
  const pending = activeTask?.status === "queued" || activeTask?.status === "running";
  const uploadFailed = uploadResult?.message != null;

  async function startExtract() {
    if (!primaryTrackId) {
      setMessage("请先选择一个主字幕轨。");
      return;
    }
    setMessage(null);
    const res = await api.post<TaskCreated>(`/api/admin/videos/${video.id}/subtitles/extract`, {
      primary_track_id: Number(primaryTrackId),
      zh_track_id: zhTrackId ? Number(zhTrackId) : null,
    });
    setTaskId(res.task_id);
  }

  async function startTranscribe() {
    setMessage(null);
    const res = await api.post<TaskCreated>(`/api/admin/videos/${video.id}/subtitles/transcribe`, {
      audio_track_id: audioTrackId ? Number(audioTrackId) : null,
      language: language.trim() || null,
      split_enabled: true,
    });
    setTaskId(res.task_id);
  }

  async function submitSubtitleFiles(e: React.FormEvent) {
    e.preventDefault();
    if (!enFile) {
      setUploadError("请选择英文字幕文件。");
      return;
    }
    setUploadError(null);
    setUploadResult(null);
    setUploadPending(true);
    setUploadProgress(0);
    try {
      const fd = new FormData();
      fd.set("en_subtitle_file", enFile);
      if (zhFile) fd.set("zh_subtitle_file", zhFile);
      const res = await uploadWithProgress<ReuploadResult>(`/api/admin/videos/${video.id}/subtitles/reupload`, fd, setUploadProgress);
      setUploadResult(res);
      if (!res.message) {
        setEnFile(null);
        setZhFile(null);
      }
      void queryClient.invalidateQueries({ queryKey: ["admin-subtitles", video.id] });
      onSaved();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploadPending(false);
    }
  }

  return (
    <section id="subtitle-source" className="surface bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">字幕来源</h2>
          <p className="mt-1 text-sm font-semibold text-muted-foreground">
            先选择视频内字幕轨；没有合适字幕时上传字幕文件；都没有时再自动生成字幕初稿。处理结果会替换当前学习字幕。
          </p>
        </div>
        <Button size="sm" variant="outline" asChild>
          <Link href={`/admin/videos/${video.id}/subtitles`}>进入字幕编辑</Link>
        </Button>
      </div>

      {video.status === "needs_subtitle" && (
        <div className="mt-4 rounded-lg border-2 border-amber-600 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
          这个视频已经导入完成，但还没有确定学习字幕。请从下方选择字幕轨、上传字幕文件，或自动生成字幕初稿。
        </div>
      )}

      <div className="mt-5 space-y-4">
        <div className="rounded-lg border border-foreground/10 bg-white/80 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-black">1. 选择视频内字幕轨</h3>
              <p className="mt-1 text-sm font-semibold text-muted-foreground">
                适合视频本身带字幕的情况。主字幕通常选择英文轨，中文字幕轨可选。
              </p>
            </div>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-black text-muted-foreground">
              已发现 {subtitleTracks.length} 个字幕轨
            </span>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="primary-track">主字幕轨</Label>
              <select
                id="primary-track"
                className="h-10 w-full rounded-md border-2 border-foreground bg-white px-3 text-sm font-semibold"
                value={primaryTrackId}
                onChange={(e) => setPrimaryTrackId(e.target.value)}
              >
                <option value="">选择字幕轨</option>
                {subtitleTracks.map((track) => (
                  <option key={track.id} value={track.id}>
                    #{track.stream_index} {track.language || "und"} {track.codec || ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="zh-track">中文字幕轨（可选）</Label>
              <select
                id="zh-track"
                className="h-10 w-full rounded-md border-2 border-foreground bg-white px-3 text-sm font-semibold"
                value={zhTrackId}
                onChange={(e) => setZhTrackId(e.target.value)}
              >
                <option value="">不使用</option>
                {subtitleTracks.map((track) => (
                  <option key={track.id} value={track.id}>
                    #{track.stream_index} {track.language || "und"} {track.codec || ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-3">
            <Button size="sm" variant="brand" onClick={startExtract} disabled={pending || uploadPending || subtitleTracks.length === 0}>
              提取选中的字幕轨
            </Button>
            {subtitleTracks.length === 0 && <span className="self-center text-xs font-bold text-muted-foreground">暂未探测到字幕轨，请上传字幕文件或自动生成字幕初稿。</span>}
          </div>
        </div>

        <form onSubmit={submitSubtitleFiles} className="rounded-lg border border-foreground/10 bg-white/80 p-4">
          <h3 className="text-base font-black">2. 上传字幕文件</h3>
          <p className="mt-1 text-sm font-semibold text-muted-foreground">
            如果你已经有字幕文件，上传后会直接替换为当前学习字幕。中文字幕会按英文字幕时间轴对齐。
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <FileDropField label="英文字幕" required accept=".vtt,.srt" hint="支持 .vtt / .srt" file={enFile} onChange={setEnFile} />
            <FileDropField label="中文字幕（可选）" accept=".vtt,.srt" hint="按时间轴自动对齐英文字幕" file={zhFile} onChange={setZhFile} />
          </div>
          {uploadPending && (
            <div className="mt-4 space-y-2">
              <div className="flex justify-between text-sm font-bold text-muted-foreground">
                <span>正在解析字幕</span>
                <span>{uploadProgress}%</span>
              </div>
              <ProgressBar value={uploadProgress} />
            </div>
          )}
          {uploadError && (
            <p className="mt-3 flex items-center gap-2 text-sm font-bold text-red-700">
              <XCircle className="h-4 w-4" />
              {uploadError}
            </p>
          )}
          {uploadResult && (
            <div className={`mt-3 space-y-2 rounded-md border-2 p-3 text-sm font-bold ${uploadFailed ? "border-red-700 bg-red-50" : "border-emerald-700 bg-emerald-50"}`}>
              {uploadFailed ? (
                <p className="flex items-start gap-2 text-red-700">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  {uploadResult.message}（旧字幕保持不变）
                </p>
              ) : (
                <p className="flex items-center gap-2 text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                  字幕已更新，共 {uploadResult.subtitle_count} 句。
                </p>
              )}
              {uploadResult.warnings.map((w, i) => (
                <p key={i} className="flex items-start gap-2 text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {w}
                </p>
              ))}
            </div>
          )}
          <Button type="submit" size="sm" variant="brand" className="mt-3" disabled={pending || uploadPending}>
            {uploadPending ? "解析中..." : "上传并解析字幕"}
          </Button>
        </form>

        <div className="rounded-lg border border-foreground/10 bg-white/80 p-4">
          <h3 className="text-base font-black">3. 自动生成字幕初稿</h3>
          <p className="mt-1 text-sm font-semibold text-muted-foreground">
            当视频没有字幕轨、你也没有字幕文件时使用。系统会临时读取音频做识别，不会提供音频导出。
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="audio-track">使用的音频轨</Label>
              <select
                id="audio-track"
                className="h-10 w-full rounded-md border-2 border-foreground bg-white px-3 text-sm font-semibold"
                value={audioTrackId}
                onChange={(e) => setAudioTrackId(e.target.value)}
              >
                <option value="">自动选择</option>
                {audioTracks.map((track) => (
                  <option key={track.id} value={track.id}>
                    #{track.stream_index} {track.language || "und"} {track.codec || ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="whisper-language">字幕语言（可选）</Label>
              <Input id="whisper-language" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="例如 en / zh，不填则自动判断" />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-3">
            <Button size="sm" variant="outline" onClick={startTranscribe} disabled={pending || uploadPending || audioTracks.length === 0}>
              自动生成字幕初稿
            </Button>
            {audioTracks.length === 0 && <span className="self-center text-xs font-bold text-muted-foreground">暂未探测到音频轨，无法自动生成字幕。</span>}
          </div>
        </div>
      </div>

      {activeTask && (
        <div className="mt-4 space-y-2">
          <div className="flex justify-between text-sm font-bold text-muted-foreground">
            <span>{taskStatusLabel(activeTask.status)}</span>
            <span>{activeTask.progress}%</span>
          </div>
          <ProgressBar value={activeTask.progress} />
        </div>
      )}
      {message && <p className="mt-3 text-sm font-bold text-muted-foreground">{message}</p>}
    </section>
  );
}

function DangerCard({
  video,
  onChanged,
  onDeleted,
}: {
  video: VideoAdmin;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const statusMutation = useMutation({
    mutationFn: (newStatus: VideoStatus) => api.put(`/api/admin/videos/${video.id}`, { status: newStatus }),
    onSuccess: onChanged,
    onError: (e) => setError(e instanceof Error ? e.message : "操作失败"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/admin/videos/${video.id}`),
    onSuccess: onDeleted,
    onError: (e) => setError(e instanceof Error ? e.message : "删除失败"),
  });

  return (
    <section className="surface bg-white p-6">
      <h2 className="text-2xl font-bold">发布与删除</h2>
      <div className="mt-4 space-y-3">
        {error && <p className="text-sm font-bold text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-3">
          {(video.status === "ready" || video.status === "unpublished") && (
            <Button variant="brand" onClick={() => statusMutation.mutate("published")} disabled={statusMutation.isPending}>
              发布视频
            </Button>
          )}
          {video.status === "published" && (
            <Button variant="outline" onClick={() => statusMutation.mutate("unpublished")} disabled={statusMutation.isPending}>
              下架视频
            </Button>
          )}
          {video.status === "failed" && (
            <p className="self-center text-sm font-bold text-muted-foreground">
              字幕解析失败，重新上传字幕成功后即可发布。
            </p>
          )}
          <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
            删除视频
          </Button>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除视频</DialogTitle>
            <DialogDescription>
              确定删除“{video.title}”吗？视频文件、封面、字幕和学习进度都会被永久删除，无法恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
              {deleteMutation.isPending ? "删除中..." : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
