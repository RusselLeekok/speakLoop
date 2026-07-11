"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Captions,
  Check,
  Languages,
  Loader2,
  Lock,
  LogOut,
  Plus,
  RotateCcw,
  Save,
  Scissors,
  Trash2,
  Unlock,
  Wand2,
} from "lucide-react";

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
import type { AdminSubtitles, ProcessingTask, Subtitle, SubtitleAlignment, SubtitleAlignmentWord, TaskCreated, VideoAdmin, VideoTrack } from "@/lib/types";
import { cn, formatMs } from "@/lib/utils";

type EditableSubtitle = {
  id: number | null;
  start_ms: number;
  end_ms: number;
  en_text: string;
  zh_text: string;
  alignment_json: SubtitleAlignment | null;
  sort_order: number;
};

const LOCKED_RETURN_DELAY_MS = 1200;
const MAX_UNDO_HISTORY = 50;

function toEditable(subtitles: Subtitle[]): EditableSubtitle[] {
  return subtitles.map((item) => ({
    id: item.id,
    start_ms: item.start_ms,
    end_ms: item.end_ms,
    en_text: item.en_text ?? "",
    zh_text: item.zh_text ?? "",
    alignment_json: cloneAlignment(item.alignment_json ?? null),
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

function cloneAlignment(alignment: SubtitleAlignment | null | undefined): SubtitleAlignment | null {
  if (!alignment?.words?.length) return null;
  return {
    source: alignment.source || "faster-whisper",
    version: alignment.version || 1,
    words: alignment.words.map((word) => ({ ...word })),
  };
}

function alignmentEqual(left: SubtitleAlignment | null, right: SubtitleAlignment | null) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function cloneRows(items: EditableSubtitle[]) {
  return items.map((item) => ({ ...item, alignment_json: cloneAlignment(item.alignment_json) }));
}

function rowsEqual(left: EditableSubtitle[], right: EditableSubtitle[]) {
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const other = right[index];
    return (
      other &&
      item.id === other.id &&
      item.start_ms === other.start_ms &&
      item.end_ms === other.end_ms &&
      item.en_text === other.en_text &&
      item.zh_text === other.zh_text &&
      alignmentEqual(item.alignment_json, other.alignment_json) &&
      item.sort_order === other.sort_order
    );
  });
}

function cleanSubtitleText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function splitWordTextAtRatio(text: string, ratio: number): [string, string] {
  const leading = text.match(/^\s*/)?.[0] ?? "";
  const body = text.trim();
  if (body.length <= 1) {
    return ratio < 0.5 ? [text, ""] : ["", text];
  }
  const cut = Math.min(body.length - 1, Math.max(1, Math.round(body.length * ratio)));
  return [`${leading}${body.slice(0, cut)}`, body.slice(cut)];
}

function splitAlignment(alignment: SubtitleAlignment | null, splitMs: number): [SubtitleAlignment | null, SubtitleAlignment | null] {
  if (!alignment?.words?.length) return [null, null];
  const leftWords: SubtitleAlignmentWord[] = [];
  const rightWords: SubtitleAlignmentWord[] = [];

  for (const word of alignment.words) {
    if (!word.text || word.end_ms <= word.start_ms) continue;
    if (word.end_ms <= splitMs) {
      leftWords.push({ ...word });
      continue;
    }
    if (word.start_ms >= splitMs) {
      rightWords.push({ ...word });
      continue;
    }
    const ratio = (splitMs - word.start_ms) / (word.end_ms - word.start_ms);
    const [leftText, rightText] = splitWordTextAtRatio(word.text, ratio);
    if (leftText.trim()) leftWords.push({ ...word, text: leftText, end_ms: splitMs });
    if (rightText.trim()) rightWords.push({ ...word, text: rightText, start_ms: splitMs });
  }

  const makeAlignment = (words: SubtitleAlignmentWord[]) =>
    words.length
      ? {
          source: alignment.source || "faster-whisper",
          version: alignment.version || 1,
          words,
        }
      : null;
  return [makeAlignment(leftWords), makeAlignment(rightWords)];
}

function splitTextByAlignment(alignment: SubtitleAlignment | null, splitMs: number): [string, string] | null {
  const [leftAlignment, rightAlignment] = splitAlignment(alignment, splitMs);
  if (!leftAlignment || !rightAlignment) return null;
  const leftText = cleanSubtitleText(leftAlignment.words.map((word) => word.text).join(""));
  const rightText = cleanSubtitleText(rightAlignment.words.map((word) => word.text).join(""));
  if (!leftText || !rightText) return null;
  return [leftText, rightText];
}

function mergeAlignment(left: SubtitleAlignment | null, right: SubtitleAlignment | null): SubtitleAlignment | null {
  const words = [...(left?.words ?? []), ...(right?.words ?? [])]
    .filter((word) => word.text && word.end_ms > word.start_ms)
    .map((word) => ({ ...word }))
    .sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms);
  if (!words.length) return null;
  return {
    source: left?.source || right?.source || "faster-whisper",
    version: left?.version || right?.version || 1,
    words,
  };
}

export default function AdminSubtitlesPage() {
  const params = useParams<{ videoId: string }>();
  const videoId = Number(params.videoId);
  const router = useRouter();
  const navigation = useNavigationFeedback();
  const queryClient = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Array<HTMLElement | null>>([]);
  const lockedReturnTimerRef = useRef<number | null>(null);
  const subtitleLockedRef = useRef(false);
  const autoReturningRef = useRef(false);
  const currentIndexRef = useRef(-1);
  const undoHistoryRef = useRef<EditableSubtitle[][]>([]);
  const savedRowsRef = useRef<EditableSubtitle[]>([]);
  const splitCaretRef = useRef<{ index: number; position: number } | null>(null);
  const [rows, setRows] = useState<EditableSubtitle[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [activeIndex, setActiveIndex] = useState(0);
  const [subtitleLocked, setSubtitleLocked] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [undoDepth, setUndoDepth] = useState(0);
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
    const nextRows = toEditable(data.subtitles);
    setRows(nextRows);
    savedRowsRef.current = cloneRows(nextRows);
    setActiveIndex(0);
    setCurrentIndex(-1);
    currentIndexRef.current = -1;
    undoHistoryRef.current = [];
    setUndoDepth(0);
    setDirty(false);
  }, [data?.subtitles]);

  useEffect(() => {
    return () => {
      if (lockedReturnTimerRef.current) window.clearTimeout(lockedReturnTimerRef.current);
    };
  }, []);

  useEffect(() => {
    rowRefs.current = rowRefs.current.slice(0, rows.length);
  }, [rows.length]);

  useEffect(() => {
    const task = taskQuery.data;
    if (task?.status === "completed") {
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
          if (idx >= 0 && subtitleLockedRef.current && !lockedReturnTimerRef.current && !autoReturningRef.current) {
            scrollToRowAnchor(idx);
          }
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
      const nextRows = toEditable(res.subtitles);
      setRows(nextRows);
      savedRowsRef.current = cloneRows(nextRows);
      undoHistoryRef.current = [];
      setUndoDepth(0);
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: ["admin-video", videoId] });
      void queryClient.invalidateQueries({ queryKey: ["admin-videos"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-subtitles", videoId] });
    },
    onError: (err) => setMessage(err instanceof Error ? err.message : "保存失败。"),
  });

  const selectedIndex = rows.length > 0 ? Math.min(Math.max(activeIndex, 0), rows.length - 1) : -1;
  const selectedRow = selectedIndex >= 0 ? rows[selectedIndex] : null;

  function resequence(items: EditableSubtitle[]) {
    return items.map((item, index) => ({ ...item, sort_order: index }));
  }

  function pushUndoSnapshot(snapshot: EditableSubtitle[]) {
    const history = undoHistoryRef.current;
    const cloned = cloneRows(snapshot);
    const last = history[history.length - 1];
    if (last && rowsEqual(last, cloned)) return;
    history.push(cloned);
    if (history.length > MAX_UNDO_HISTORY) history.shift();
    setUndoDepth(history.length);
  }

  function commitRows(nextRows: EditableSubtitle[], nextActiveIndex = activeIndex) {
    const normalized = resequence(nextRows);
    if (!rowsEqual(rows, normalized)) pushUndoSnapshot(rows);
    setRows(normalized);
    setActiveIndex(normalized.length ? Math.min(Math.max(nextActiveIndex, 0), normalized.length - 1) : 0);
    setDirty(!rowsEqual(normalized, savedRowsRef.current));
  }

  function undoLastChange() {
    const previousRows = undoHistoryRef.current.pop();
    if (!previousRows) return;
    const restoredRows = cloneRows(previousRows);
    setRows(restoredRows);
    setActiveIndex(previousRows.length ? Math.min(activeIndex, previousRows.length - 1) : 0);
    setUndoDepth(undoHistoryRef.current.length);
    setDirty(!rowsEqual(restoredRows, savedRowsRef.current));
  }

  function requestTranslation() {
    setMessage(null);
  }

function splitText(text: string) {
  const clean = text.trim();
  if (!clean) return ["", ""];
    const midpoint = Math.floor(clean.length / 2);
    const leftSpace = clean.lastIndexOf(" ", midpoint);
    const rightSpace = clean.indexOf(" ", midpoint);
    const cut =
      leftSpace > clean.length * 0.28
        ? leftSpace
        : rightSpace > 0 && rightSpace < clean.length * 0.72
          ? rightSpace
          : midpoint;
  return [clean.slice(0, cut).trim(), clean.slice(cut).trim()];
}

function splitTextAtPosition(text: string, position: number): [string, string] | null {
  if (position <= 0 || position >= text.length) return null;
  const first = text.slice(0, position).trim();
  const second = text.slice(position).trim();
  if (!first || !second) return null;
  return [first, second];
}

function textUnitCount(text: string) {
  return cleanSubtitleText(text).replace(/\s/g, "").length;
}

function splitMsFromTextPosition(text: string, position: number, alignment: SubtitleAlignment | null) {
  if (!alignment?.words?.length || position <= 0 || position >= text.length) return null;
  const targetUnits = textUnitCount(text.slice(0, position));
  if (targetUnits <= 0) return null;

  let units = 0;
  for (const word of alignment.words) {
    const wordUnits = textUnitCount(word.text);
    if (wordUnits <= 0 || word.end_ms <= word.start_ms) continue;
    if (targetUnits < units + wordUnits) {
      const ratio = (targetUnits - units) / wordUnits;
      return Math.round(word.start_ms + (word.end_ms - word.start_ms) * ratio);
    }
    if (targetUnits === units + wordUnits) return word.end_ms;
    units += wordUnits;
  }

  return null;
}

  function addSubtitleAfterSelection(baseIndex = selectedIndex) {
    const items = [...rows];
    const pivotIndex = baseIndex >= 0 ? baseIndex : items.length - 1;
    const pivot = items[pivotIndex];
    const next = items[pivotIndex + 1];
    const hasGap = pivot && next && next.start_ms - pivot.end_ms >= 500;
    const start = hasGap
      ? pivot.end_ms
      : items.length > 0
        ? items[items.length - 1].end_ms
        : Math.floor((videoRef.current?.currentTime ?? 0) * 1000);
    const end = hasGap && next ? next.start_ms : start + 2000;
    const insertIndex = hasGap ? pivotIndex + 1 : items.length;
    items.splice(insertIndex, 0, {
      id: null,
      start_ms: start,
      end_ms: end,
      en_text: "",
      zh_text: "",
      alignment_json: null,
      sort_order: insertIndex,
    });
    commitRows(items, insertIndex);
    window.setTimeout(() => scrollToRowAnchor(insertIndex), 0);
  }

  function deleteSelectedSubtitle() {
    if (selectedIndex < 0) return;
    commitRows(rows.filter((_, index) => index !== selectedIndex), Math.max(0, selectedIndex - 1));
  }

  function mergeSelectedSubtitle() {
    if (selectedIndex < 0 || selectedIndex >= rows.length - 1) return;
    const current = rows[selectedIndex];
    const next = rows[selectedIndex + 1];
    const merged: EditableSubtitle = {
      ...current,
      end_ms: next.end_ms,
      en_text: `${current.en_text.trim()} ${next.en_text.trim()}`.replace(/\s+/g, " ").trim(),
      zh_text: `${current.zh_text.trim()} ${next.zh_text.trim()}`.replace(/\s+/g, " ").trim(),
      alignment_json: mergeAlignment(current.alignment_json, next.alignment_json),
    };
    const items = [...rows];
    items.splice(selectedIndex, 2, merged);
    commitRows(items, selectedIndex);
  }

  function splitSelectedSubtitle() {
    if (selectedIndex < 0) return;
    const current = rows[selectedIndex];
    if (current.end_ms - current.start_ms < 400) return;
    const playbackMs = Math.floor((videoRef.current?.currentTime ?? -1) * 1000);
    const midpoint = Math.round((current.start_ms + current.end_ms) / 2);
    const caret = splitCaretRef.current?.index === selectedIndex ? splitCaretRef.current.position : null;
    const caretSplitMs = caret != null ? splitMsFromTextPosition(current.en_text, caret, current.alignment_json) : null;
    const splitMs =
      playbackMs > current.start_ms && playbackMs < current.end_ms
        ? playbackMs
        : caretSplitMs && caretSplitMs > current.start_ms && caretSplitMs < current.end_ms
          ? caretSplitMs
          : midpoint;
    const manualEn = caret != null ? splitTextAtPosition(current.en_text, caret) : null;
    const alignedEn = splitTextByAlignment(current.alignment_json, splitMs);
    const [firstEn, secondEn] = manualEn ?? alignedEn ?? splitText(current.en_text);
    const [firstZh, secondZh] = splitText(current.zh_text);
    const [firstAlignment, secondAlignment] = splitAlignment(current.alignment_json, splitMs);
    const first: EditableSubtitle = {
      ...current,
      end_ms: splitMs,
      en_text: firstEn || current.en_text,
      zh_text: firstZh,
      alignment_json: firstAlignment,
    };
    const second: EditableSubtitle = {
      id: null,
      start_ms: splitMs,
      end_ms: current.end_ms,
      en_text: secondEn,
      zh_text: secondZh,
      alignment_json: secondAlignment,
      sort_order: current.sort_order + 1,
    };
    const items = [...rows];
    items.splice(selectedIndex, 1, first, second);
    commitRows(items, selectedIndex + 1);
  }

  function clearLockedReturnTimer() {
    if (lockedReturnTimerRef.current) {
      window.clearTimeout(lockedReturnTimerRef.current);
      lockedReturnTimerRef.current = null;
    }
  }

  function setSubtitleLock(locked: boolean) {
    subtitleLockedRef.current = locked;
    setSubtitleLocked(locked);
    if (!locked) clearLockedReturnTimer();
  }

  function scrollToRowAnchor(index: number, behavior: ScrollBehavior = "smooth") {
    const container = timelineRef.current;
    const item = rowRefs.current[index];
    if (!container || !item) return;
    const containerRect = container.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const anchor = container.clientHeight * 0.34;
    const nextTop = container.scrollTop + itemRect.top - containerRect.top - anchor;
    autoReturningRef.current = true;
    container.scrollTo({ top: Math.max(0, nextTop), behavior });
    window.setTimeout(() => {
      autoReturningRef.current = false;
    }, behavior === "smooth" ? 900 : 120);
  }

  function scrollToCurrentPlayback() {
    const currentTime = Math.floor((videoRef.current?.currentTime ?? 0) * 1000);
    const nextIndex = findIndexAt(currentTime, rows);
    if (nextIndex >= 0) {
      currentIndexRef.current = nextIndex;
      setCurrentIndex(nextIndex);
      setActiveIndex(nextIndex);
      scrollToRowAnchor(nextIndex);
    }
  }

  function scheduleLockedReturn() {
    clearLockedReturnTimer();
    if (!subtitleLockedRef.current) return;
    lockedReturnTimerRef.current = window.setTimeout(() => {
      lockedReturnTimerRef.current = null;
      if (!subtitleLockedRef.current) return;
      scrollToCurrentPlayback();
    }, LOCKED_RETURN_DELAY_MS);
  }

  function beginEditingRow(index: number) {
    setActiveIndex(index);
    clearLockedReturnTimer();
  }

  function rememberSplitCaret(index: number, element: HTMLTextAreaElement) {
    splitCaretRef.current = {
      index,
      position: element.selectionStart ?? 0,
    };
  }

  function toggleSubtitleLock() {
    if (subtitleLockedRef.current) {
      setSubtitleLock(false);
      return;
    }
    setSubtitleLock(true);
    scrollToCurrentPlayback();
  }

  function updateRow(index: number, patch: Partial<EditableSubtitle>) {
    const nextRows = rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row));
    if (rowsEqual(rows, nextRows)) return;
    pushUndoSnapshot(rows);
    setRows(nextRows);
    setActiveIndex(index);
    setDirty(!rowsEqual(nextRows, savedRowsRef.current));
  }

  function playWithoutPausing(el: HTMLVideoElement) {
    const play = () => {
      void el.play().catch(() => {
        // Browser can reject if the click gesture is no longer active.
      });
    };
    play();
    window.requestAnimationFrame(play);
    window.setTimeout(play, 120);
  }

  function seekTo(row: EditableSubtitle, index: number, shouldPlay = true) {
    setActiveIndex(index);
    setCurrentIndex(index);
    currentIndexRef.current = index;
    const el = videoRef.current;
    if (!el) return;
    if (shouldPlay) {
      const resumeAfterSeek = () => playWithoutPausing(el);
      el.addEventListener("seeked", resumeAfterSeek, { once: true });
      el.addEventListener("canplay", resumeAfterSeek, { once: true });
      playWithoutPausing(el);
      el.currentTime = row.start_ms / 1000 + 0.001;
      playWithoutPausing(el);
      if (subtitleLockedRef.current) scrollToRowAnchor(index);
    } else {
      el.currentTime = row.start_ms / 1000 + 0.001;
      el.pause();
      setSubtitleLock(true);
      scheduleLockedReturn();
    }
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
    <div className="-mt-4 w-full max-w-none space-y-3 md:-mt-6">
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

      <div className="grid min-h-[calc(100dvh-7.5rem)] gap-4 xl:grid-cols-[minmax(0,1.34fr)_minmax(32rem,0.82fr)] 2xl:grid-cols-[minmax(50rem,1.42fr)_minmax(37rem,0.85fr)]">
        <section className="surface flex min-h-[calc(100dvh-7.5rem)] flex-col bg-white p-4">
          <div className="flex items-center">
            <Button variant="ghost" size="icon" onClick={requestExit} aria-label="返回最终确认页" title={video?.title ? `返回：${video.title}` : "返回"}>
              <ArrowLeft />
            </Button>
          </div>
          <div className="flex flex-1 items-center py-4">
            <div className="w-full overflow-hidden rounded-lg border-2 border-foreground bg-black shadow-soft">
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
          </div>
        </section>

        <section className="surface bg-white p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-2 py-1">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={undoLastChange} disabled={undoDepth === 0} title="撤销上一步修改">
                <RotateCcw className="h-4 w-4" />
                撤回
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={requestTranslation} disabled={rows.length === 0} title="预留中文翻译入口">
                <Languages className="h-4 w-4" />
                翻译
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || rows.length === 0}>
                <Save className="h-4 w-4" />
                {saveMutation.isPending ? "保存中..." : "保存"}
              </Button>
              <Button type="button" size="sm" variant="brand" onClick={saveAndExit} disabled={saveMutation.isPending || rows.length === 0}>
                <Save className="h-4 w-4" />
                保存退出
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={requestExit}>
                <LogOut className="h-4 w-4" />
                退出
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-start justify-between gap-3 px-2 py-1">
            <h2 className="text-lg font-black">字幕列表（{rows.length} 句）</h2>
            {dirty && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-900">有未保存修改</span>}
          </div>
          <div className="mb-1 flex flex-wrap items-center gap-2 px-2">
            <Button type="button" size="sm" variant="outline" onClick={() => addSubtitleAfterSelection()}>
              <Plus className="h-4 w-4" />
              新增
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={mergeSelectedSubtitle} disabled={selectedIndex < 0 || selectedIndex >= rows.length - 1}>
              <Check className="h-4 w-4" />
              合并
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={splitSelectedSubtitle} disabled={!selectedRow || selectedRow.end_ms - selectedRow.start_ms < 400}>
              <Scissors className="h-4 w-4" />
              拆分
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={deleteSelectedSubtitle} disabled={selectedIndex < 0}>
              <Trash2 className="h-4 w-4" />
              删除
            </Button>
            <Button
              type="button"
              size="sm"
              variant={subtitleLocked ? "brand" : "outline"}
              onClick={toggleSubtitleLock}
              title={subtitleLocked ? "取消锁定字幕列表" : "锁定字幕列表，让当前播放字幕固定在同一位置切换"}
            >
              {subtitleLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
              {subtitleLocked ? "取消锁定" : "锁定"}
            </Button>
          </div>
          {isLoading ? (
            <div className="space-y-3 p-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-28 w-full rounded-lg" />
              ))}
            </div>
          ) : rows.length > 0 ? (
            <div
              ref={timelineRef}
              className="thin-scrollbar max-h-[calc(100dvh-16rem)] space-y-3 overflow-auto p-2 pr-3 [scroll-padding-top:24px]"
              onScroll={() => {
                if (!subtitleLockedRef.current || autoReturningRef.current) return;
                scheduleLockedReturn();
              }}
            >
              {rows.map((row, index) => (
                <article
                  key={`${row.id ?? "new"}-${index}`}
                  ref={(node) => {
                    rowRefs.current[index] = node;
                  }}
                  data-subtitle-index={index}
                  className={cn(
                    "group grid cursor-pointer gap-2 text-sm sm:grid-cols-[4.35rem_minmax(0,1fr)]",
                    index === activeIndex && "active",
                    index === currentIndex && "playing"
                  )}
                  onClick={() => seekTo(row, index, true)}
                >
                  <button
                    type="button"
                    className={cn(
                      "pt-1.5 text-left font-mono text-[11px] font-bold leading-snug tabular-nums text-muted-foreground transition-colors",
                      index === currentIndex && "text-[#476b97]",
                      index === activeIndex && "text-foreground"
                    )}
                    onClick={(event) => {
                      event.stopPropagation();
                      seekTo(row, index, true);
                    }}
                  >
                    <span className="block text-foreground">#{index + 1}</span>
                    <span>{formatMs(row.start_ms)}</span>
                    <span className="block">{formatMs(row.end_ms)}</span>
                  </button>
                  <div
                    className={cn(
                      "relative min-h-[74px] rounded-lg border border-foreground/10 bg-white p-3 shadow-sm transition-[background,border-color,box-shadow]",
                      index === activeIndex && "border-[#e3ca63] bg-[#fff7cf] shadow-[0_0_0_2px_rgba(227,202,99,0.28)]",
                      index === currentIndex && index !== activeIndex && "border-[#9bb6d9] bg-[#f3f7fd] shadow-[0_0_0_2px_rgba(155,182,217,0.28)]"
                    )}
                  >
                    <div className="absolute right-2 top-2 hidden gap-1 group-hover:flex group-focus-within:flex">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 bg-white/80"
                        title="播放"
                        onClick={(event) => {
                          event.stopPropagation();
                          seekTo(row, index, true);
                        }}
                      >
                        <Captions className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 bg-white/80"
                        title="Insert subtitle"
                        onClick={(event) => {
                          event.stopPropagation();
                          addSubtitleAfterSelection(index);
                        }}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="mb-2 flex flex-wrap gap-2 pr-[4.5rem]" onClick={(event) => event.stopPropagation()}>
                      <Input
                        type="number"
                        step="0.01"
                        value={seconds(row.start_ms)}
                        onFocus={() => beginEditingRow(index)}
                        onChange={(e) => updateRow(index, { start_ms: msFromSeconds(e.target.value) })}
                        className={cn("h-7 w-20 px-2 font-mono text-xs", index === activeIndex && "border-[#c2aa38]/40 bg-white/70")}
                      />
                      <Input
                        type="number"
                        step="0.01"
                        value={seconds(row.end_ms)}
                        onFocus={() => beginEditingRow(index)}
                        onChange={(e) => updateRow(index, { end_ms: msFromSeconds(e.target.value) })}
                        className={cn("h-7 w-20 px-2 font-mono text-xs", index === activeIndex && "border-[#c2aa38]/40 bg-white/70")}
                      />
                    </div>
                    <div className="space-y-1.5" onClick={(event) => event.stopPropagation()}>
                      <Textarea
                        value={row.en_text}
                        onFocus={(event) => {
                          beginEditingRow(index);
                          rememberSplitCaret(index, event.currentTarget);
                        }}
                        onClick={(event) => rememberSplitCaret(index, event.currentTarget)}
                        onKeyUp={(event) => rememberSplitCaret(index, event.currentTarget)}
                        onSelect={(event) => rememberSplitCaret(index, event.currentTarget)}
                        onChange={(e) => {
                          rememberSplitCaret(index, e.currentTarget);
                          updateRow(index, { en_text: e.target.value, alignment_json: null });
                        }}
                        rows={2}
                        className={cn("min-h-[54px] px-3 py-1.5 leading-snug", index === activeIndex && "text-foreground")}
                      />
                      <Textarea
                        value={row.zh_text}
                        onFocus={() => beginEditingRow(index)}
                        onChange={(e) => updateRow(index, { zh_text: e.target.value })}
                        rows={1}
                        placeholder="中文字幕，可选"
                        className={cn("min-h-[40px] px-3 py-1.5 leading-snug", index === activeIndex && "text-foreground")}
                      />
                    </div>
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
