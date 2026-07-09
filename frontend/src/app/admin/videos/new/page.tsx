"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  FileVideo2,
  Link2,
  ListChecks,
  Loader2,
  PenLine,
  Sparkles,
  UploadCloud,
  XCircle,
} from "lucide-react";

import { FileDropField } from "@/components/file-drop-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, uploadWithProgress } from "@/lib/api";
import type { ProcessingTask, TaskCreated, UploadResult, VideoAdmin, VideoTrack } from "@/lib/types";
import { cn } from "@/lib/utils";

type Mode = "url" | "upload";

const sourceOptions: Array<{
  mode: Mode;
  title: string;
  badge?: string;
  description: string;
}> = [
  {
    mode: "url",
    title: "在线视频 URL",
    badge: "推荐",
    description: "粘贴链接后系统会下载视频、检测字幕轨；没有字幕时自动生成字幕初稿。",
  },
  {
    mode: "upload",
    title: "本地视频文件",
    description: "上传自己的视频。字幕文件可以一起上传，也可以导入后再处理。",
  },
];

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

function fileTitle(file: File | null) {
  if (!file?.name) return "未命名视频";
  return file.name.replace(/\.[^.]+$/, "").trim() || "未命名视频";
}

function isTaskPending(task?: ProcessingTask | null) {
  return task?.status === "queued" || task?.status === "running";
}

export default function AdminVideoNewPage() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("url");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [publishNow, setPublishNow] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [enFile, setEnFile] = useState<File | null>(null);
  const [zhFile, setZhFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [showSubtitleFiles, setShowSubtitleFiles] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [taskId, setTaskId] = useState<number | null>(null);
  const [videoId, setVideoId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const taskQuery = useQuery({
    queryKey: ["admin-task", taskId],
    queryFn: () => api.get<ProcessingTask>(`/api/admin/tasks/${taskId}`),
    enabled: taskId != null,
    refetchInterval: (query) => (isTaskPending(query.state.data) ? 1500 : false),
  });

  function resetResult() {
    setError(null);
    setTaskId(null);
    setVideoId(null);
    setProgress(0);
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    resetResult();
    if (!videoFile) {
      setError("请选择要导入的视频文件。");
      return;
    }
    if (zhFile && !enFile) {
      setError("上传中文字幕时，也需要同时上传英文字幕，系统会按英文字幕时间轴对齐。");
      return;
    }
    const tags = parseTagsInput(tagsInput);
    if (tags.length > 4) {
      setError("一个视频最多只能设置 4 个标签。");
      return;
    }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("title", title.trim() || fileTitle(videoFile));
      if (description.trim()) fd.set("description", description.trim());
      if (tags.length > 0) fd.set("tags", JSON.stringify(tags));
      fd.set("publish_now", String(publishNow));
      fd.set("video_file", videoFile);
      if (enFile) fd.set("en_subtitle_file", enFile);
      if (zhFile) fd.set("zh_subtitle_file", zhFile);
      if (coverFile) fd.set("cover_file", coverFile);
      const res = await uploadWithProgress<UploadResult>("/api/admin/videos", fd, setProgress);
      setTaskId(res.task_id);
      setVideoId(res.video_id);
      void queryClient.invalidateQueries({ queryKey: ["admin-videos"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败，请检查文件格式或稍后重试。");
    } finally {
      setUploading(false);
    }
  }

  async function handleUrlImport(e: React.FormEvent) {
    e.preventDefault();
    resetResult();
    const tags = parseTagsInput(tagsInput);
    if (!url.trim()) {
      setError("请先粘贴视频 URL。");
      return;
    }
    if (tags.length > 4) {
      setError("一个视频最多只能设置 4 个标签。");
      return;
    }

    setUploading(true);
    try {
      const res = await api.post<TaskCreated>("/api/admin/videos/import-url", {
        url: url.trim(),
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        tags,
        publish_now: publishNow,
      });
      setTaskId(res.task_id);
      setVideoId(res.video_id);
      void queryClient.invalidateQueries({ queryKey: ["admin-videos"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败，请检查链接是否可访问。");
    } finally {
      setUploading(false);
    }
  }

  const task = taskQuery.data;
  const pending = uploading || isTaskPending(task);
  const taskProgress = task?.progress ?? (uploading ? progress : 0);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/videos" aria-label="返回视频列表">
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-brand/25 bg-white/80 px-3 py-1 text-xs font-black text-brand shadow-sm">
            <Sparkles className="h-3.5 w-3.5" />
            URL 优先 · 字幕可后处理
          </div>
          <h1 className="mt-3 text-3xl font-black tracking-normal sm:text-4xl">导入学习视频</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-muted-foreground">
            先把视频导入进来，系统会自动检测字幕轨；没有字幕时生成可编辑的字幕初稿。导入完成后再逐句检查和修改。
          </p>
        </div>
      </div>

      <ImportStepper pending={pending} completed={task?.status === "completed"} />

      <Card className="bg-white">
        <CardContent className="pt-6">
          <form onSubmit={mode === "upload" ? handleUpload : handleUrlImport} className="space-y-6">
            <section className="space-y-3">
              <div>
                <h2 className="text-xl font-black">1. 选择视频来源</h2>
                <p className="mt-1 text-sm font-semibold text-muted-foreground">
                  大多数学习素材来自网络链接，所以这里默认使用 URL 导入。
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {sourceOptions.map((item) => {
                  const active = mode === item.mode;
                  const Icon = item.mode === "url" ? Link2 : FileVideo2;
                  return (
                    <button
                      key={item.mode}
                      type="button"
                      className={cn(
                        "rounded-lg border-2 p-4 text-left transition-all",
                        active
                          ? "border-brand bg-brand/10 shadow-soft"
                          : "border-foreground/10 bg-white hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-soft"
                      )}
                      onClick={() => {
                        setMode(item.mode);
                        resetResult();
                      }}
                    >
                      <span className="flex items-start gap-3">
                        <span className={cn("rounded-md p-2", active ? "bg-brand text-brand-foreground" : "bg-muted text-muted-foreground")}>
                          <Icon className="h-5 w-5" />
                        </span>
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-2 text-base font-black">
                            {item.title}
                            {item.badge && (
                              <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-black text-accent-foreground">
                                {item.badge}
                              </span>
                            )}
                          </span>
                          <span className="mt-1 block text-sm font-semibold leading-5 text-muted-foreground">{item.description}</span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <div className="space-y-5">
                {mode === "url" ? (
                  <div className="space-y-2">
                    <Label htmlFor="url">视频 URL <span className="text-destructive">*</span></Label>
                    <Input
                      id="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://..."
                      className="h-12 text-base font-bold"
                      autoFocus
                    />
                    <p className="text-xs font-semibold text-muted-foreground">
                      支持 yt-dlp 可下载的视频链接。系统会保存本地副本，方便稳定播放和字幕处理。
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <FileDropField
                      label="视频文件"
                      required
                      accept=".mp4,.webm,.mkv,.mov"
                      hint="拖拽或选择 .mp4 / .webm / .mkv / .mov"
                      file={videoFile}
                      onChange={setVideoFile}
                    />
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 text-sm font-black text-brand hover:underline"
                      onClick={() => setShowSubtitleFiles((value) => !value)}
                    >
                      <UploadCloud className="h-4 w-4" />
                      {showSubtitleFiles ? "收起字幕文件" : "我已有字幕文件，可一起上传"}
                    </button>
                    {showSubtitleFiles && (
                      <div className="grid gap-4 rounded-lg border border-foreground/10 bg-muted/30 p-4 sm:grid-cols-2">
                        <FileDropField
                          label="英文字幕（可选）"
                          accept=".vtt,.srt"
                          hint="支持 .vtt / .srt；也可以稍后处理"
                          file={enFile}
                          onChange={setEnFile}
                        />
                        <FileDropField
                          label="中文字幕（可选）"
                          accept=".vtt,.srt"
                          hint="按英文字幕时间轴自动对齐"
                          file={zhFile}
                          onChange={setZhFile}
                        />
                      </div>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  className="inline-flex items-center gap-2 text-sm font-black text-foreground hover:text-brand"
                  onClick={() => setShowDetails((value) => !value)}
                >
                  <PenLine className="h-4 w-4" />
                  {showDetails ? "收起可选信息" : "可选：标题、标签、简介和封面"}
                </button>

                {showDetails && (
                  <div className="space-y-4 rounded-lg border border-foreground/10 bg-white/70 p-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="title">标题（可选）</Label>
                        <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="tags">标签（最多 4 个）</Label>
                        <Input
                          id="tags"
                          value={tagsInput}
                          onChange={(e) => setTagsInput(e.target.value)}
                          placeholder="例如：A1入门，TED，旅行"
                        />
                        <p className="text-xs font-semibold text-muted-foreground">用逗号、顿号或换行分隔。</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="description">简介（可选）</Label>
                      <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
                    </div>
                    {mode === "upload" && (
                      <FileDropField
                        label="封面图片（可选）"
                        accept=".jpg,.jpeg,.png,.webp"
                        hint="不上传时后端会尝试自动生成"
                        file={coverFile}
                        onChange={setCoverFile}
                      />
                    )}
                  </div>
                )}

                <label className="flex cursor-pointer items-center gap-2 text-sm font-bold">
                  <Switch checked={publishNow} onCheckedChange={setPublishNow} />
                  字幕准备好后立即发布
                </label>
              </div>

              <div className="rounded-lg border border-brand/20 bg-brand/5 p-4">
                <h3 className="flex items-center gap-2 text-base font-black">
                  <ListChecks className="h-4 w-4 text-brand" />
                  系统会怎么处理
                </h3>
                <ol className="mt-3 space-y-3 text-sm font-semibold leading-5 text-muted-foreground">
                  <li className="flex gap-2"><span className="font-black text-foreground">1</span>保存视频，并生成封面和时长信息。</li>
                  <li className="flex gap-2"><span className="font-black text-foreground">2</span>检测视频里的字幕轨和音频轨。</li>
                  <li className="flex gap-2"><span className="font-black text-foreground">3</span>有字幕就自动提取；多个字幕轨会让你选择。</li>
                  <li className="flex gap-2"><span className="font-black text-foreground">4</span>没有字幕时自动生成字幕初稿，之后可逐句修改。</li>
                </ol>
              </div>
            </section>

            {(uploading || task) && (
              <ProcessingCard mode={mode} task={task} progress={taskProgress} uploading={uploading} videoId={videoId} />
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-lg border-2 border-destructive bg-red-50 px-4 py-3 text-sm font-bold text-destructive">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <Button type="submit" variant="brand" size="lg" disabled={pending}>
                {pending ? (
                  <>
                    <Loader2 className="animate-spin" />
                    处理中...
                  </>
                ) : mode === "url" ? (
                  "开始导入并识别字幕"
                ) : (
                  "上传并识别字幕"
                )}
              </Button>
              <Button type="button" variant="outline" size="lg" asChild>
                <Link href="/admin/videos">稍后再导入</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function ImportStepper({ pending, completed }: { pending: boolean; completed: boolean }) {
  const steps = [
    { label: "选择来源", active: true },
    { label: "字幕准备方式", active: pending || completed },
    { label: "检查并修改", active: completed },
  ];
  return (
    <div className="grid gap-2 rounded-lg border border-foreground/10 bg-white/70 p-2 shadow-sm sm:grid-cols-3">
      {steps.map((step, index) => (
        <div
          key={step.label}
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-black",
            step.active ? "bg-foreground text-white" : "bg-transparent text-muted-foreground"
          )}
        >
          <span className={cn("grid h-6 w-6 place-items-center rounded-full text-xs", step.active ? "bg-white text-foreground" : "bg-muted text-muted-foreground")}>
            {index + 1}
          </span>
          {step.label}
        </div>
      ))}
    </div>
  );
}

function ProcessingCard({
  mode,
  task,
  progress,
  uploading,
  videoId,
}: {
  mode: Mode;
  task?: ProcessingTask | null;
  progress: number;
  uploading: boolean;
  videoId: number | null;
}) {
  const failed = task?.status === "failed";
  const completed = task?.status === "completed";

  return (
    <div
      className={cn(
        "rounded-lg border-2 p-4",
        failed ? "border-red-700 bg-red-50" : completed ? "border-emerald-700 bg-emerald-50" : "border-brand/30 bg-brand/5"
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn("rounded-full p-2", failed ? "bg-red-100 text-red-700" : completed ? "bg-emerald-100 text-emerald-700" : "bg-brand/15 text-brand")}>
          {failed ? <XCircle className="h-5 w-5" /> : completed ? <CheckCircle2 className="h-5 w-5" /> : <Loader2 className="h-5 w-5 animate-spin" />}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h3 className="text-lg font-black">
              {failed ? "处理失败" : completed ? "导入完成" : uploading ? (mode === "url" ? "正在创建导入任务" : "正在上传视频") : "正在导入视频"}
            </h3>
            <p className="mt-1 text-sm font-semibold text-muted-foreground">
              {failed
                ? task?.error_message || "系统没有完成处理。可以重试、上传字幕文件，或检查视频来源。"
                : completed
                  ? "视频已经导入，下一步处理学习字幕。"
                  : "系统正在下载或分析视频，请保持页面打开查看进度。"}
            </p>
          </div>

          {!failed && !completed && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm font-bold text-muted-foreground">
                <span>{mode === "url" ? "下载 / 检测 / 识别字幕" : "上传 / 检测 / 识别字幕"}</span>
                <span>{progress}%</span>
              </div>
              <ProgressBar value={progress} />
              <div className="grid gap-2 text-xs font-bold text-muted-foreground sm:grid-cols-4">
                <span>1. 保存视频</span>
                <span>2. 检测轨道</span>
                <span>3. 准备字幕</span>
                <span>4. 进入编辑</span>
              </div>
            </div>
          )}

          {completed && <TaskOutcome task={task} videoId={videoId} />}
          {failed && videoId && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="brand" asChild>
                <Link href={`/admin/videos/${videoId}/edit`}>去字幕来源处理</Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href="/admin/videos/new">重新导入</Link>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TaskOutcome({ task, videoId }: { task?: ProcessingTask | null; videoId: number | null }) {
  const { data: video } = useQuery({
    queryKey: ["admin-video", videoId],
    queryFn: () => api.get<VideoAdmin>(`/api/admin/videos/${videoId}`),
    enabled: videoId != null && task?.status === "completed",
  });
  const { data: tracks } = useQuery({
    queryKey: ["admin-video-tracks", videoId],
    queryFn: () => api.get<VideoTrack[]>(`/api/admin/videos/${videoId}/tracks`),
    enabled: videoId != null && task?.status === "completed",
  });

  if (!videoId) {
    return <p className="text-sm font-bold text-muted-foreground">任务已完成，请回到视频列表查看结果。</p>;
  }

  const subtitleTracks = (tracks ?? []).filter((track) => track.track_type === "subtitle");
  const subtitleCount = video?.subtitle_count ?? Number(task?.result_json?.subtitle_count ?? 0);
  const hasSubtitles = subtitleCount > 0;
  const needsTrackChoice = video?.status === "needs_subtitle" && subtitleTracks.length > 0;

  if (hasSubtitles) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-bold text-emerald-800">
          字幕已准备好，共 {subtitleCount} 句。下一步预览视频、确认封面和信息，然后发布。
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="brand" asChild>
            <Link href={`/admin/videos/${videoId}/edit`}>预览并完成发布</Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href={`/admin/videos/${videoId}/subtitles`}>检查字幕</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (needsTrackChoice) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-bold text-emerald-800">
          发现 {subtitleTracks.length} 个字幕轨。请选择一个作为学习字幕，也可以选择中文字幕轨用于双语显示。
        </p>
        <Button size="sm" variant="brand" asChild>
          <Link href={`/admin/videos/${videoId}/edit`}>选择字幕轨</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-bold text-emerald-800">
        视频已导入。可以先预览视频并完善封面、标题、说明和标签；发布前仍需要准备学习字幕。
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="brand" asChild>
          <Link href={`/admin/videos/${videoId}/edit`}>预览并完善信息</Link>
        </Button>
        <Button size="sm" variant="outline" asChild>
          <Link href={`/admin/videos/${videoId}/edit#subtitle-source`}>准备字幕</Link>
        </Button>
      </div>
    </div>
  );
}
