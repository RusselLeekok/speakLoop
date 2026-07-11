"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronDown,
  ListRestart,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  Volume2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import { getLocalProgress, saveLocalProgress } from "@/lib/local-progress";
import type { Progress, Subtitle, VideoDetail } from "@/lib/types";
import { cn, formatDuration, formatMs } from "@/lib/utils";

function findCurrentSubtitle(currentMs: number, subtitles: Subtitle[]) {
  let left = 0;
  let right = subtitles.length - 1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const item = subtitles[mid];
    if (currentMs < item.start_ms) right = mid - 1;
    else if (currentMs >= item.end_ms) left = mid + 1;
    else return { subtitle: item, index: mid };
  }
  return { subtitle: null, index: -1 };
}

function findNextIndex(currentMs: number, subtitles: Subtitle[]) {
  let left = 0;
  let right = subtitles.length;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (subtitles[mid].start_ms <= currentMs) left = mid + 1;
    else right = mid;
  }
  return left;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

type SubtitleLanguage = "both" | "zh" | "en";
type PracticeMode = "off" | "blind" | "blank" | "repeat" | "intensive";
type StudyItemKind = "word" | "phrase";
type StudyStatus = "unknown" | "known";

type StudyItem = {
  id: string;
  kind: StudyItemKind;
  term: string;
  subtitleIndex: number;
  sentence: string;
  translation: string | null;
  meaning: string;
  hint: string;
  pronunciation: string;
};

const LANGUAGE_OPTIONS: { value: SubtitleLanguage; label: string }[] = [
  { value: "both", label: "双语" },
  { value: "zh", label: "中文" },
  { value: "en", label: "英语" },
];

const PRACTICE_OPTIONS: { value: PracticeMode; label: string }[] = [
  { value: "off", label: "关闭" },
  { value: "blind", label: "盲听" },
  { value: "blank", label: "填空" },
  { value: "repeat", label: "跟读" },
  { value: "intensive", label: "精读" },
];

const LOCKED_RETURN_DELAY_MS = 1200;

export default function LearnPage() {
  const params = useParams<{ videoId: string }>();
  const videoId = Number(params.videoId);
  const token = useAuthStore((s) => s.token);

  const { data: video, isLoading: videoLoading, error: videoError } = useQuery({
    queryKey: ["video", videoId],
    queryFn: () => api.get<VideoDetail>(`/api/videos/${videoId}`),
    enabled: Number.isFinite(videoId),
  });

  const { data: subtitles, isLoading: subsLoading } = useQuery({
    queryKey: ["subtitles", videoId],
    queryFn: () => api.get<Subtitle[]>(`/api/videos/${videoId}/subtitles`),
    enabled: Number.isFinite(videoId),
  });

  const { data: serverProgress, isFetched: progressFetched } = useQuery({
    queryKey: ["progress", videoId, token],
    queryFn: () => api.get<Progress | null>(`/api/videos/${videoId}/progress`),
    enabled: !!token && Number.isFinite(videoId),
  });

  if (videoError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-aurora text-foreground">
        <p className="text-lg font-bold">视频不存在或暂未发布</p>
        <Button variant="secondary" asChild>
          <Link href="/">返回首页</Link>
        </Button>
      </div>
    );
  }

  if (videoLoading || subsLoading || !video || !subtitles || (token && !progressFetched)) {
    return (
      <div className="min-h-screen bg-aurora p-6">
        <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-4">
            <Skeleton className="h-8 w-64 rounded-md" />
            <Skeleton className="aspect-video w-full rounded-lg" />
            <Skeleton className="h-28 w-full rounded-lg" />
          </div>
          <Skeleton className="hidden h-[80vh] rounded-lg lg:block" />
        </div>
      </div>
    );
  }

  const initialMs =
    serverProgress?.last_time_ms ?? getLocalProgress(videoId)?.last_time_ms ?? 0;

  return <Player video={video} subtitles={subtitles} initialMs={initialMs} />;
}

function Player({
  video,
  subtitles,
  initialMs,
}: {
  video: VideoDetail;
  subtitles: Subtitle[];
  initialMs: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<number, HTMLElement>());

  const [currentIndex, setCurrentIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [language, setLanguage] = useState<SubtitleLanguage>("both");
  const [subtitlesHidden, setSubtitlesHidden] = useState(false);
  const [practiceMode, setPracticeMode] = useState<PracticeMode>("off");
  const [practiceOpen, setPracticeOpen] = useState(false);
  const [practiceMenuPosition, setPracticeMenuPosition] = useState({ left: 0, top: 0 });
  const [activeStudyItem, setActiveStudyItem] = useState<StudyItem | null>(null);
  const [studyPopupPosition, setStudyPopupPosition] = useState({ left: 0, top: 0 });
  const [studyStatuses, setStudyStatuses] = useState<Record<string, StudyStatus>>({});
  const [looping, setLooping] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [timeText, setTimeText] = useState("0:00");
  const [currentSec, setCurrentSec] = useState(0);
  const [durationSec, setDurationSec] = useState(video.duration ?? 0);
  const [restored, setRestored] = useState(initialMs > 3000);

  const currentIndexRef = useRef(-1);
  const loopTargetRef = useRef<Subtitle | null>(null);
  const practiceMenuRef = useRef<HTMLDivElement>(null);
  const practicePopupRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const practiceModeRef = useRef<PracticeMode>("off");
  const lockedReturnTimerRef = useRef<number | null>(null);
  const autoReturningRef = useRef(false);
  const restoreAppliedRef = useRef(false);
  autoScrollRef.current = autoScroll;
  practiceModeRef.current = practiceMode;

  const hasZh = useMemo(() => subtitles.some((s) => s.zh_text), [subtitles]);
  const studyItems = useMemo(() => collectStudyItems(subtitles), [subtitles]);
  const studyItemsBySubtitle = useMemo(() => {
    const map = new Map<number, StudyItem[]>();
    studyItems.forEach((item) => {
      const list = map.get(item.subtitleIndex) ?? [];
      list.push(item);
      map.set(item.subtitleIndex, list);
    });
    return map;
  }, [studyItems]);

  const cycleLanguage = useCallback(() => {
    setLanguage((prev) => {
      const options = hasZh ? LANGUAGE_OPTIONS : LANGUAGE_OPTIONS.filter((item) => item.value !== "zh");
      const index = options.findIndex((item) => item.value === prev);
      return options[(index + 1) % options.length]?.value ?? "both";
    });
  }, [hasZh]);

  const clearLockedReturnTimer = useCallback(() => {
    if (lockedReturnTimerRef.current) {
      window.clearTimeout(lockedReturnTimerRef.current);
      lockedReturnTimerRef.current = null;
    }
  }, []);

  const scrollToIndex = useCallback(
    (index: number, behavior: ScrollBehavior = "smooth") => {
      const container = listRef.current;
      const sub = subtitles[index];
      if (!container || !sub) return;
      const item = itemRefs.current.get(sub.id);
      if (!item) return;
      const containerRect = container.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();
      const anchor = container.clientHeight * 0.34;
      const top = container.scrollTop + itemRect.top - containerRect.top - anchor;
      autoReturningRef.current = true;
      container.scrollTo({ top: Math.max(0, top), behavior });
      window.setTimeout(() => {
        autoReturningRef.current = false;
      }, behavior === "smooth" ? 900 : 120);
    },
    [subtitles]
  );

  const scrollToCurrentSubtitle = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const index = currentIndexRef.current;
      if (index >= 0) scrollToIndex(index, behavior);
    },
    [scrollToIndex]
  );

  const scheduleLockedReturn = useCallback(() => {
    clearLockedReturnTimer();
    if (!autoScrollRef.current || practiceModeRef.current === "intensive") return;
    lockedReturnTimerRef.current = window.setTimeout(() => {
      lockedReturnTimerRef.current = null;
      if (!autoScrollRef.current || practiceModeRef.current === "intensive") return;
      scrollToCurrentSubtitle();
    }, LOCKED_RETURN_DELAY_MS);
  }, [clearLockedReturnTimer, scrollToCurrentSubtitle]);

  const setSubtitleLock = useCallback(
    (locked: boolean) => {
      autoScrollRef.current = locked;
      setAutoScroll(locked);
      if (!locked) {
        clearLockedReturnTimer();
        return;
      }
      if (practiceModeRef.current !== "intensive") scrollToCurrentSubtitle();
    },
    [clearLockedReturnTimer, scrollToCurrentSubtitle]
  );

  useEffect(() => {
    return () => clearLockedReturnTimer();
  }, [clearLockedReturnTimer]);

  useEffect(() => {
    let rafId: number;
    const sync = () => {
      const el = videoRef.current;
      if (el) {
        const currentMs = Math.floor(el.currentTime * 1000);
        const loopTarget = loopTargetRef.current;
        if (loopTarget && currentMs >= loopTarget.end_ms) {
          el.currentTime = loopTarget.start_ms / 1000;
        } else {
          const { index } = findCurrentSubtitle(currentMs, subtitles);
          if (index !== currentIndexRef.current) {
            currentIndexRef.current = index;
            setCurrentIndex(index);
            if (
              index >= 0 &&
              autoScrollRef.current &&
              practiceModeRef.current !== "intensive" &&
              !lockedReturnTimerRef.current &&
              !autoReturningRef.current
            ) {
              scrollToIndex(index);
            }
          }
        }
      }
      rafId = requestAnimationFrame(sync);
    };
    rafId = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(rafId);
  }, [subtitles, scrollToIndex]);

  const saveProgress = useCallback(() => {
    const el = videoRef.current;
    if (!el || el.currentTime < 1) return;
    const ms = Math.floor(el.currentTime * 1000);
    const sub = findCurrentSubtitle(ms, subtitles).subtitle;
    saveLocalProgress(video.id, ms, sub?.id ?? null);
    if (useAuthStore.getState().token) {
      api
        .put(`/api/videos/${video.id}/progress`, {
          last_time_ms: ms,
          last_subtitle_id: sub?.id ?? null,
        })
        .catch(() => {});
    }
  }, [video.id, subtitles]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (videoRef.current && !videoRef.current.paused) saveProgress();
    }, 5000);
    window.addEventListener("beforeunload", saveProgress);
    return () => {
      clearInterval(interval);
      window.removeEventListener("beforeunload", saveProgress);
      saveProgress();
    };
  }, [saveProgress]);

  useEffect(() => {
    if (!restored) return;
    const timer = window.setTimeout(() => setRestored(false), 5000);
    return () => window.clearTimeout(timer);
  }, [restored]);

  const applyRestore = useCallback(() => {
    const el = videoRef.current;
    if (!el || restoreAppliedRef.current) return;
    restoreAppliedRef.current = true;
    const duration = el.duration;
    if (initialMs > 3000 && (!isFinite(duration) || initialMs / 1000 < duration - 2)) {
      el.currentTime = initialMs / 1000;
    }
  }, [initialMs]);

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }, []);

  const seekToSubtitle = useCallback(
    (index: number, opts: { play?: boolean } = {}) => {
      const el = videoRef.current;
      const sub = subtitles[index];
      if (!el || !sub) return;
      el.currentTime = sub.start_ms / 1000 + 0.001;
      if (loopTargetRef.current) loopTargetRef.current = sub;
      if (opts.play && el.paused) void el.play();
    },
    [subtitles]
  );

  const jumpToStudyItem = useCallback(
    (item: StudyItem, opts: { play?: boolean } = { play: true }) => {
      seekToSubtitle(item.subtitleIndex, opts);
      currentIndexRef.current = item.subtitleIndex;
      setCurrentIndex(item.subtitleIndex);
      clearLockedReturnTimer();
      if (autoScrollRef.current && practiceModeRef.current !== "intensive") {
        scrollToIndex(item.subtitleIndex);
      }
    },
    [clearLockedReturnTimer, seekToSubtitle, scrollToIndex]
  );

  const openStudyItem = useCallback((item: StudyItem, event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 280;
    setStudyPopupPosition({
      left: Math.min(Math.max(rect.left + rect.width / 2, width / 2 + 12), window.innerWidth - width / 2 - 12),
      top: Math.min(rect.bottom + 10, window.innerHeight - 220),
    });
    setActiveStudyItem(item);
  }, []);

  const cycleStudyStatus = useCallback((itemId: string) => {
    setStudyStatuses((prev) => {
      const next = { ...prev };
      if (!next[itemId]) next[itemId] = "unknown";
      else if (next[itemId] === "unknown") next[itemId] = "known";
      else delete next[itemId];
      return next;
    });
  }, []);

  const goPrev = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    const currentMs = Math.floor(el.currentTime * 1000);
    const idx = currentIndexRef.current;
    if (idx > 0) {
      const sub = subtitles[idx];
      seekToSubtitle(currentMs - sub.start_ms > 1000 ? idx : idx - 1);
    } else if (idx === 0) {
      seekToSubtitle(0);
    } else {
      const next = findNextIndex(currentMs, subtitles);
      seekToSubtitle(Math.max(0, next - 1));
    }
  }, [subtitles, seekToSubtitle]);

  const goNext = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    const currentMs = Math.floor(el.currentTime * 1000);
    const idx = currentIndexRef.current;
    if (idx >= 0 && idx < subtitles.length - 1) seekToSubtitle(idx + 1);
    else if (idx === -1) {
      const next = findNextIndex(currentMs, subtitles);
      if (next < subtitles.length) seekToSubtitle(next);
    }
  }, [subtitles, seekToSubtitle]);

  const skip = useCallback((seconds: number) => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, el.currentTime + seconds);
  }, []);

  const toggleLoop = useCallback(() => {
    setLooping((prev) => {
      const next = !prev;
      if (next) {
        const idx = currentIndexRef.current;
        loopTargetRef.current =
          idx >= 0
            ? subtitles[idx]
            : subtitles[
                Math.max(
                  0,
                  findNextIndex(Math.floor((videoRef.current?.currentTime ?? 0) * 1000), subtitles) - 1
                )
              ] ?? null;
      } else {
        loopTargetRef.current = null;
      }
      return next;
    });
  }, [subtitles]);

  const changeSpeed = useCallback((value: number) => {
    setSpeed(value);
    if (videoRef.current) videoRef.current.playbackRate = value;
  }, []);

  const positionPracticeMenu = useCallback(() => {
    const rect = practiceMenuRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = 96;
    const left = Math.min(
      Math.max(rect.left + rect.width / 2, menuWidth / 2 + 8),
      window.innerWidth - menuWidth / 2 - 8
    );
    const below = rect.bottom + 8;
    const menuHeight = 190;
    const top = below + menuHeight > window.innerHeight - 8 ? Math.max(8, rect.top - menuHeight - 8) : below;
    setPracticeMenuPosition({ left, top });
  }, []);

  const choosePracticeMode = useCallback((value: PracticeMode) => {
    setPracticeMode(value);
    setPracticeOpen(false);
    if (value === "blind") setSubtitlesHidden(true);
    if (value === "off") setSubtitlesHidden(false);
    if (value === "blank" || value === "repeat" || value === "intensive") {
      setSubtitlesHidden(false);
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === "r" || e.key === "R") {
        toggleLoop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, goPrev, goNext, toggleLoop]);

  useEffect(() => {
    if (!practiceOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!practiceMenuRef.current?.contains(target) && !practicePopupRef.current?.contains(target)) {
        setPracticeOpen(false);
      }
    };
    positionPracticeMenu();
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", positionPracticeMenu);
    window.addEventListener("scroll", positionPracticeMenu, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", positionPracticeMenu);
      window.removeEventListener("scroll", positionPracticeMenu, true);
    };
  }, [practiceOpen, positionPracticeMenu]);

  useEffect(() => {
    if (!activeStudyItem) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest("[data-study-popover]") || target?.closest("[data-study-term]")) return;
      setActiveStudyItem(null);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [activeStudyItem]);

  const currentSub = currentIndex >= 0 ? subtitles[currentIndex] : null;
  const showEn = language === "both" || language === "en";
  const showZh = language === "both" || language === "zh";
  const languageLabel = LANGUAGE_OPTIONS.find((item) => item.value === language)?.label ?? "双语";
  const practiceLabel = PRACTICE_OPTIONS.find((item) => item.value === practiceMode)?.label ?? "练习";

  return (
    <div className="flex min-h-screen flex-col bg-aurora text-foreground">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b-2 border-foreground bg-white/95 px-4 shadow-soft lg:px-5">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/videos/${video.id}`} aria-label="返回素材详情">
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold">{video.title}</h1>
        <div className="hidden items-center gap-1.5 text-xs font-bold text-muted-foreground sm:flex">
          <Kbd>Space</Kbd>
          播放
          <Kbd>←/→</Kbd>
          上下句
          <Kbd>R</Kbd>
          循环
        </div>
      </header>

      <div
        className={cn(
          "mx-auto grid h-[calc(100dvh-3.5rem)] min-h-0 w-full max-w-[calc(100vw-8px)] flex-1 items-stretch overflow-hidden p-1.5 lg:p-2",
          practiceMode === "intensive"
            ? "gap-y-3 lg:max-w-[1900px] lg:grid-cols-[minmax(0,1fr)_380px_340px] lg:gap-x-0 xl:grid-cols-[minmax(0,1fr)_420px_360px]"
            : "gap-3 lg:grid-cols-[minmax(0,1fr)_400px] xl:max-w-[1760px] xl:grid-cols-[minmax(0,1fr)_440px]"
        )}
      >
        <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto] gap-2.5 lg:h-[calc(100dvh-4.5rem)]">
          <div
            className="relative mx-auto aspect-video max-h-[calc(100dvh-12rem)] w-full self-center overflow-hidden rounded-lg border-2 border-foreground bg-black shadow-elevated"
            style={{ maxWidth: "min(100%, calc(177.78dvh - 21.33rem))" }}
          >
            <video
              ref={videoRef}
              src={video.file_url}
              className="h-full w-full bg-black object-contain"
              playsInline
              onPlay={() => setPlaying(true)}
              onPause={() => {
                setPlaying(false);
                saveProgress();
              }}
              onLoadedMetadata={(e) => {
                applyRestore();
                e.currentTarget.playbackRate = speed;
                if (isFinite(e.currentTarget.duration)) setDurationSec(e.currentTarget.duration);
              }}
              onTimeUpdate={(e) => {
                setTimeText(formatDuration(e.currentTarget.currentTime));
                setCurrentSec(e.currentTarget.currentTime);
              }}
              onClick={togglePlay}
            />
            {currentSub && !subtitlesHidden && practiceMode !== "blind" && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 via-black/35 to-transparent px-4 pb-5 pt-16 text-center text-white">
                <div className="pointer-events-auto mx-auto max-w-4xl space-y-1.5 rounded-md bg-black/25 px-4 py-2 backdrop-blur-[2px]">
                  {showEn && currentSub.en_text && (
                    <p className="text-lg font-bold leading-relaxed drop-shadow md:text-xl">
                      {practiceMode === "blank" ? (
                        <ClozeText text={currentSub.en_text} />
                      ) : (
                        <HighlightedSubtitleText
                          text={currentSub.en_text}
                          items={studyItemsBySubtitle.get(currentIndex) ?? []}
                          statuses={studyStatuses}
                          onTermClick={openStudyItem}
                        />
                      )}
                    </p>
                  )}
                  {showZh &&
                    (currentSub.zh_text ? (
                      <p className="text-sm font-semibold leading-relaxed text-white/85 drop-shadow md:text-base">
                        {currentSub.zh_text}
                      </p>
                    ) : (
                      language === "zh" && <p className="text-sm font-semibold text-white/70">本句暂无中文字幕</p>
                    ))}
                </div>
              </div>
            )}
            {restored && initialMs > 3000 && (
              <div className="absolute left-3 top-3 flex flex-wrap items-center gap-2 rounded-md border-2 border-foreground bg-accent px-3 py-2 text-xs font-bold shadow-soft">
                已恢复到 {formatDuration(initialMs / 1000)}
                <button
                  className="rounded-sm underline underline-offset-4"
                  onClick={() => {
                    if (videoRef.current) videoRef.current.currentTime = 0;
                    setRestored(false);
                  }}
                >
                  从头开始
                </button>
                <button className="rounded-sm underline underline-offset-4" onClick={() => setRestored(false)}>
                  收起
                </button>
              </div>
            )}
          </div>

          <div className="surface shrink-0 rounded-lg px-4 py-2.5">
            <div className="mb-3 flex items-center gap-3">
              <span className="w-12 text-right font-mono text-xs font-bold tabular-nums text-muted-foreground">
                {timeText}
              </span>
              <input
                type="range"
                min={0}
                max={durationSec || 0}
                step={0.1}
                value={Math.min(currentSec, durationSec || 0)}
                onChange={(e) => {
                  if (videoRef.current) videoRef.current.currentTime = Number(e.target.value);
                }}
                className="player-seek h-3 flex-1 cursor-pointer rounded-full border-2 border-foreground bg-white"
                aria-label="播放进度"
              />
              <span className="w-12 font-mono text-xs font-bold tabular-nums text-muted-foreground">
                {formatDuration(durationSec)}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <ControlButton title="快退 5 秒" onClick={() => skip(-5)}>
                <RotateCcw className="h-4 w-4" />
                <span className="hidden text-xs md:inline">5s</span>
              </ControlButton>
              <ControlButton title="上一句" onClick={goPrev}>
                <SkipBack className="h-4 w-4" />
              </ControlButton>
              <button
                title="播放 / 暂停"
                onClick={togglePlay}
                className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-foreground bg-brand text-foreground shadow-soft transition-transform hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
              >
                {playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
              </button>
              <ControlButton title="下一句" onClick={goNext}>
                <SkipForward className="h-4 w-4" />
              </ControlButton>
              <ControlButton title="快进 5 秒" onClick={() => skip(5)}>
                <RotateCw className="h-4 w-4" />
                <span className="hidden text-xs md:inline">5s</span>
              </ControlButton>
              <ControlButton title="当前句循环" onClick={toggleLoop} active={looping}>
                <Repeat className="h-4 w-4" />
                <span className="text-xs">循环</span>
              </ControlButton>
              <select
                title="播放速度"
                value={speed}
                onChange={(e) => changeSpeed(Number(e.target.value))}
                className="h-10 rounded-md border-2 border-foreground bg-white px-2.5 text-sm font-bold shadow-soft focus:outline-none"
              >
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s}x
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <aside
          className={cn(
            "surface flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-white/95 lg:h-[calc(100dvh-4.5rem)]",
            practiceMode === "intensive" && "lg:rounded-r-none lg:border-r-0"
          )}
        >
          <div className="relative z-40 rounded-t-lg border-b-2 border-foreground/10 bg-white px-4 py-3">
            <h2 className="flex items-baseline gap-2 text-base font-black">
              动态字幕 <span className="text-sm font-bold text-muted-foreground">{subtitles.length} 句</span>
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px] font-black text-[#b695ff]">
              <ToolbarButton onClick={cycleLanguage} title="切换字幕语言">
                {languageLabel}
              </ToolbarButton>
              <ToolbarButton
                onClick={() => {
                  setSubtitlesHidden((prev) => {
                    const next = !prev;
                    if (!next && practiceMode === "blind") setPracticeMode("off");
                    return next;
                  });
                }}
                title={subtitlesHidden ? "显示字幕" : "隐藏字幕"}
                active={subtitlesHidden}
              >
                {subtitlesHidden ? "隐藏" : "字幕"}
              </ToolbarButton>
              <div ref={practiceMenuRef} className="relative">
                <ToolbarButton
                  onClick={() => {
                    positionPracticeMenu();
                    setPracticeOpen((prev) => !prev);
                  }}
                  title="选择练习模式"
                  active={practiceMode !== "off" || practiceOpen}
                >
                  {practiceMode === "off" ? "练习" : practiceLabel}
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", practiceOpen && "rotate-180")} />
                </ToolbarButton>
              </div>
              <label
                className={cn(
                  "ml-auto flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-black transition-colors",
                  autoScroll
                    ? "border-foreground bg-[#e9f8ff] text-foreground shadow-soft"
                    : "border-foreground/10 bg-[#f6f6f3] text-muted-foreground"
                )}
                title={autoScroll ? "锁定中：播放字幕会固定回到同一位置" : "取消锁定：只高亮当前句，不移动列表"}
              >
                <Switch checked={autoScroll} onCheckedChange={setSubtitleLock} />
                {autoScroll ? "锁定" : "取消锁定"}
              </label>
            </div>
            <p className="mt-2 text-xs font-bold text-muted-foreground">
              {autoScroll ? "锁定中：手动查看其他字幕后，会稍后回到当前播放句。" : "未锁定：播放时只高亮当前句，字幕列表不会自动滚动。"}
            </p>
          </div>

          <div
            ref={listRef}
            className="thin-scrollbar fade-mask-y relative z-0 min-h-0 flex-1 overflow-y-auto scroll-smooth rounded-b-lg bg-[#f7f8f4] p-3"
            onScroll={() => {
              if (!autoScrollRef.current || autoReturningRef.current || practiceModeRef.current === "intensive") return;
              scheduleLockedReturn();
            }}
          >
            <ol className="relative space-y-2.5">
              {subtitles.map((sub, i) => {
                const active = i === currentIndex;
                return (
                  <li key={sub.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      ref={(el) => {
                        if (el) itemRefs.current.set(sub.id, el);
                        else itemRefs.current.delete(sub.id);
                      }}
                      onClick={() => {
                        seekToSubtitle(i, { play: true });
                        clearLockedReturnTimer();
                        if (autoScrollRef.current && practiceModeRef.current !== "intensive") scrollToIndex(i);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          seekToSubtitle(i, { play: true });
                          clearLockedReturnTimer();
                          if (autoScrollRef.current && practiceModeRef.current !== "intensive") scrollToIndex(i);
                        }
                      }}
                      className={cn(
                        "cursor-pointer",
                        "relative block w-full rounded-lg border-2 px-3.5 py-3 text-left transition-all",
                        active
                          ? "border-foreground bg-accent text-foreground shadow-soft"
                          : "border-foreground/10 bg-white text-foreground shadow-sm hover:border-brand/70 hover:bg-[#fbfdff]"
                      )}
                    >
                      {practiceMode === "blank" && sub.en_text && (
                        <span className="absolute right-3 top-3 rounded-full bg-[#f3eaff] px-2 py-0.5 text-[11px] font-black text-[#9a63ff]">
                          0/1
                        </span>
                      )}
                      <div className="mb-2 flex items-center gap-2">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 font-mono text-[11px] font-black tabular-nums",
                            active ? "bg-foreground text-white" : "bg-[#eef0ea] text-muted-foreground"
                          )}
                        >
                          {formatMs(sub.start_ms).slice(0, 5)}
                        </span>
                        {active && <span className="text-[11px] font-black text-foreground/70">正在播放</span>}
                      </div>
                      <BlurredSubtitle hidden={subtitlesHidden} compact>
                        {language !== "zh" && (
                          <span className={cn("block text-[15px] leading-7", active && "font-black")}>
                            {practiceMode === "blank" ? (
                              <ClozeText text={sub.en_text} />
                            ) : (
                              <HighlightedSubtitleText
                                text={sub.en_text}
                                items={studyItemsBySubtitle.get(i) ?? []}
                                statuses={studyStatuses}
                                onTermClick={openStudyItem}
                              />
                            )}
                          </span>
                        )}
                        {practiceMode !== "blank" &&
                          (language === "both" || language === "zh" || subtitlesHidden) &&
                          sub.zh_text && (
                          <span className="mt-1 block text-sm font-semibold leading-6 text-muted-foreground">
                            {sub.zh_text}
                          </span>
                        )}
                      </BlurredSubtitle>
                    </div>
                  </li>
                );
              })}
            </ol>

            {autoScroll && practiceMode !== "intensive" && currentIndex >= 0 && (
              <div className="pointer-events-none sticky bottom-3 flex justify-center">
                <Button size="sm" variant="brand" className="pointer-events-auto" onClick={() => scrollToCurrentSubtitle()}>
                  <ListRestart className="h-4 w-4" />
                  回到当前句
                </Button>
              </div>
            )}
          </div>
        </aside>

        {practiceMode === "intensive" && (
          <IntensivePanel
            currentSub={currentSub}
            subtitles={subtitles}
            currentIndex={currentIndex}
            studyItems={studyItems}
            statuses={studyStatuses}
            onReadItem={jumpToStudyItem}
            onCycleStatus={cycleStudyStatus}
            onClose={() => setPracticeMode("off")}
          />
        )}
        {activeStudyItem &&
          typeof document !== "undefined" &&
          createPortal(
            <StudyTermPopover
              item={activeStudyItem}
              status={studyStatuses[activeStudyItem.id]}
              position={studyPopupPosition}
              onClose={() => setActiveStudyItem(null)}
              onSpeak={() => speakText(activeStudyItem.term)}
              onRead={() => jumpToStudyItem(activeStudyItem, { play: true })}
              onCycleStatus={() => cycleStudyStatus(activeStudyItem.id)}
            />,
            document.body
          )}
        {practiceOpen &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              ref={practicePopupRef}
              style={{ left: practiceMenuPosition.left, top: practiceMenuPosition.top }}
              className="fixed z-[9999] w-24 -translate-x-1/2 overflow-hidden rounded-lg border border-[#e8dcff] bg-white py-1.5 text-sm font-black text-foreground opacity-100 shadow-[0_18px_42px_rgba(40,24,88,0.24),0_0_0_1px_rgba(255,255,255,1)]"
            >
              {PRACTICE_OPTIONS.map((item) => (
                <button
                  type="button"
                  key={item.value}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    choosePracticeMode(item.value);
                  }}
                  className={cn(
                    "block w-full bg-white px-4 py-2 text-left transition-colors hover:bg-[#f2e9ff]",
                    practiceMode === item.value && "bg-[#f2e9ff] text-[#8f5cff]"
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.body
          )}
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-md border-2 border-foreground bg-accent px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground shadow-soft">
      {children}
    </kbd>
  );
}

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "because",
  "before",
  "could",
  "from",
  "have",
  "there",
  "these",
  "they",
  "this",
  "that",
  "with",
  "would",
  "your",
  "will",
  "well",
  "into",
  "only",
  "some",
  "when",
  "then",
  "them",
  "than",
  "what",
  "were",
  "been",
]);

const COMMON_MEANINGS: Record<string, string> = {
  leader: "n. 领导者；负责人",
  company: "n. 公司；企业",
  communicate: "v. 沟通；表达",
  mission: "n. 使命；任务",
  vision: "n. 愿景；视野",
  values: "n. 价值观",
  employees: "n. 员工",
  direction: "n. 方向；指引",
  humility: "n. 谦逊；谦卑",
  translated: "v. 翻译；转化",
  legendary: "adj. 传奇的",
  chairman: "n. 主席；董事长",
  memoir: "n. 回忆录",
  management: "n. 管理",
  success: "n. 成功",
  complex: "adj. 复杂的",
  challenging: "adj. 有挑战的",
  frustration: "n. 挫败；沮丧",
  optimistic: "adj. 乐观的",
};

function normalizeTerm(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makeStudyId(kind: StudyItemKind, term: string, subtitleIndex: number) {
  return `${kind}-${subtitleIndex}-${normalizeTerm(term).replace(/\s+/g, "-")}`;
}

function getClozeParts(text: string | null) {
  if (!text) return null;
  const matches = Array.from(text.matchAll(/[A-Za-z][A-Za-z'-]*/g));
  const target =
    [...matches]
      .reverse()
      .find((match) => match[0].length >= 4 && !STOP_WORDS.has(match[0].toLowerCase())) ??
    matches[matches.length - 1];
  if (!target || target.index == null) return null;
  const start = target.index;
  const word = target[0];
  return {
    before: text.slice(0, start),
    word,
    after: text.slice(start + word.length),
  };
}

function ClozeText({ text }: { text: string | null }) {
  const parts = getClozeParts(text);
  if (!text) return null;
  if (!parts) return <>{text}</>;
  return (
    <>
      {parts.before}
      <span className="mx-1 inline-flex min-w-[5.5rem] translate-y-1 items-end justify-center rounded-sm bg-[#f7f0ff] px-3 pt-1 text-transparent shadow-[inset_0_-1px_0_#b995ff]">
        {parts.word}
      </span>
      {parts.after}
    </>
  );
}

function collectStudyItems(subtitles: Subtitle[]) {
  const seen = new Set<string>();
  const items: StudyItem[] = [];

  subtitles.forEach((sub, subtitleIndex) => {
    const sentence = sub.en_text ?? "";
    const words = sentence.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
    const word = [...words]
      .map((raw) => raw.toLowerCase())
      .filter((raw) => raw.length >= 6 && !STOP_WORDS.has(raw))
      .sort((a, b) => b.length - a.length)[0];

    if (word && !seen.has(`word:${word}`)) {
      seen.add(`word:${word}`);
      items.push({
        id: makeStudyId("word", word, subtitleIndex),
        kind: "word",
        term: word,
        subtitleIndex,
        sentence,
        translation: sub.zh_text,
        meaning: COMMON_MEANINGS[word] ?? "重点词；建议反复听辨",
        hint: "在原句中听到这个词时，注意重音和连读。",
        pronunciation: `/${word}/`,
      });
    }

    const phrase = pickPhrase(sentence);
    const normalizedPhrase = phrase ? normalizeTerm(phrase) : "";
    if (phrase && normalizedPhrase && !seen.has(`phrase:${normalizedPhrase}`)) {
      seen.add(`phrase:${normalizedPhrase}`);
      items.push({
        id: makeStudyId("phrase", phrase, subtitleIndex),
        kind: "phrase",
        term: phrase,
        subtitleIndex,
        sentence,
        translation: sub.zh_text,
        meaning: "phr. 重点短语；按整块表达记忆",
        hint: "不要逐词翻译，跟着整句节奏读出来。",
        pronunciation: `/${phrase.toLowerCase()}/`,
      });
    }
  });

  const words = items.filter((item) => item.kind === "word").slice(0, 18);
  const phrases = items.filter((item) => item.kind === "phrase").slice(0, 18);
  return [...words, ...phrases].sort((a, b) => a.subtitleIndex - b.subtitleIndex || a.term.length - b.term.length);
}

function pickPhrase(sentence: string) {
  const tokens = Array.from(sentence.matchAll(/[A-Za-z][A-Za-z'-]*/g)).map((match) => match[0]);
  const candidates: { phrase: string; score: number }[] = [];

  for (let size = 2; size <= 4; size += 1) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      const slice = tokens.slice(index, index + size);
      const normalized = slice.map((word) => word.toLowerCase());
      const content = normalized.filter((word) => word.length >= 4 && !STOP_WORDS.has(word));
      if (content.length < 2) continue;
      const phrase = slice.join(" ");
      if (phrase.length < 8 || phrase.length > 46) continue;
      const score = content.length * 8 + Math.min(phrase.length, 32) - normalized.filter((word) => STOP_WORDS.has(word)).length * 3;
      candidates.push({ phrase, score });
    }
  }

  return candidates.sort((a, b) => b.score - a.score)[0]?.phrase ?? null;
}

function splitTextByStudyItems(text: string, items: StudyItem[]) {
  if (!items.length) return [{ text, item: null as StudyItem | null }];
  const matches: { start: number; end: number; item: StudyItem }[] = [];

  items
    .slice()
    .sort((a, b) => b.term.length - a.term.length)
    .forEach((item) => {
      const source = escapeRegExp(item.term).replace(/\s+/g, "\\s+");
      const regex = new RegExp(`\\b${source}\\b`, "gi");
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text))) {
        matches.push({ start: match.index, end: match.index + match[0].length, item });
      }
    });

  const accepted: { start: number; end: number; item: StudyItem }[] = [];
  matches
    .sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start))
    .forEach((match) => {
      if (accepted.some((item) => match.start < item.end && match.end > item.start)) return;
      accepted.push(match);
    });

  if (!accepted.length) return [{ text, item: null as StudyItem | null }];
  const parts: { text: string; item: StudyItem | null }[] = [];
  let cursor = 0;
  accepted.forEach((match) => {
    if (match.start > cursor) parts.push({ text: text.slice(cursor, match.start), item: null });
    parts.push({ text: text.slice(match.start, match.end), item: match.item });
    cursor = match.end;
  });
  if (cursor < text.length) parts.push({ text: text.slice(cursor), item: null });
  return parts;
}

function HighlightedSubtitleText({
  text,
  items,
  statuses,
  onTermClick,
}: {
  text: string | null;
  items: StudyItem[];
  statuses: Record<string, StudyStatus>;
  onTermClick: (item: StudyItem, event: React.MouseEvent<HTMLElement>) => void;
}) {
  if (!text) return null;
  return (
    <>
      {splitTextByStudyItems(text, items).map((part, index) =>
        part.item ? (
          <button
            key={`${part.item.id}-${index}`}
            type="button"
            data-study-term
            onClick={(event) => onTermClick(part.item!, event)}
            className={cn(
              "inline rounded-sm border-b-2 border-[#16a34a] pb-0.5 text-left font-semibold transition-colors hover:bg-[#e8f3ea] focus:outline-none focus:ring-2 focus:ring-[#88c79d]",
              statuses[part.item.id] === "unknown" && "border-[#e85a7a] bg-[#fff0f5]",
              statuses[part.item.id] === "known" && "border-[#8f5cff] bg-[#f5efff]"
            )}
          >
            {part.text}
          </button>
        ) : (
          <span key={`plain-${index}`}>{part.text}</span>
        )
      )}
    </>
  );
}

function speakText(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 0.86;
  window.speechSynthesis.speak(utterance);
}

function IntensivePanel({
  currentSub,
  subtitles,
  currentIndex,
  studyItems,
  statuses,
  onReadItem,
  onCycleStatus,
  onClose,
}: {
  currentSub: Subtitle | null;
  subtitles: Subtitle[];
  currentIndex: number;
  studyItems: StudyItem[];
  statuses: Record<string, StudyStatus>;
  onReadItem: (item: StudyItem) => void;
  onCycleStatus: (itemId: string) => void;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"words" | "phrases" | "expressions">("words");
  const [filter, setFilter] = useState<"all" | "unmarked" | "unknown" | "known">("all");
  const anchorIndexRef = useRef(Math.max(0, currentIndex));
  const words = studyItems.filter((item) => item.kind === "word");
  const phrases = studyItems.filter((item) => item.kind === "phrase");
  const tabItems = activeTab === "words" ? words : activeTab === "phrases" ? phrases : [];
  const anchorIndex = anchorIndexRef.current;
  const sortedItems = tabItems
    .slice()
    .sort((a, b) => Math.abs(a.subtitleIndex - anchorIndex) - Math.abs(b.subtitleIndex - anchorIndex));
  const filteredItems = sortedItems.filter((item) => {
    const status = statuses[item.id];
    if (filter === "unmarked") return !status;
    if (filter === "unknown") return status === "unknown";
    if (filter === "known") return status === "known";
    return true;
  });
  const filters: { value: typeof filter; label: string; count: number }[] = [
    { value: "all", label: "全部", count: tabItems.length },
    { value: "unmarked", label: "未标记", count: tabItems.filter((item) => !statuses[item.id]).length },
    { value: "unknown", label: "不认识", count: tabItems.filter((item) => statuses[item.id] === "unknown").length },
    { value: "known", label: "认识", count: tabItems.filter((item) => statuses[item.id] === "known").length },
  ];

  return (
    <aside className="surface flex min-h-[50vh] flex-col overflow-hidden rounded-lg bg-white lg:h-[calc(100vh-4.5rem)] lg:min-h-0 lg:rounded-l-none lg:border-l lg:border-l-[#eadfff] lg:shadow-soft">
      <div className="flex items-center justify-between rounded-tr-lg border-b border-[#efe7ff] bg-white px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-black">
          <span className="h-3 w-3 rounded-sm border border-[#c7a8ff] bg-[#f2e9ff]" />
          精读卡片
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1 text-muted-foreground hover:bg-[#f2e9ff] hover:text-[#8f5cff]"
          title="关闭精读卡片"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="border-b border-[#efe7ff] bg-white px-4 py-3">
        <div className="grid grid-cols-3 rounded-full bg-[#faf7ff] p-1 text-center text-xs font-black text-muted-foreground">
          <button
            type="button"
            onClick={() => setActiveTab("words")}
            className={cn("rounded-full px-2 py-1.5", activeTab === "words" && "bg-white text-[#8f5cff] shadow-sm")}
          >
            单词 ({words.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("phrases")}
            className={cn("rounded-full px-2 py-1.5", activeTab === "phrases" && "bg-white text-[#8f5cff] shadow-sm")}
          >
            短语 ({phrases.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("expressions")}
            className={cn("rounded-full px-2 py-1.5", activeTab === "expressions" && "bg-white text-[#8f5cff] shadow-sm")}
          >
            地道表达 (0)
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-black">
          {filters.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setFilter(item.value)}
              className={cn(
                "rounded-full border border-[#eadfff] px-2.5 py-1 text-[#8f5cff] transition-colors hover:bg-[#f7f0ff]",
                filter === item.value && "border-[#b995ff] bg-[#b995ff] text-white"
              )}
            >
              {item.label} ({item.count})
            </button>
          ))}
        </div>
      </div>

      <div className="thin-scrollbar flex-1 space-y-3 overflow-y-auto bg-white p-3">
        {(activeTab === "words" || activeTab === "phrases") && filteredItems.length > 0 ? (
          filteredItems.map((item) => (
            <StudyCard
              key={item.id}
              item={item}
              status={statuses[item.id]}
              onRead={() => onReadItem(item)}
              onSpeak={() => speakText(item.term)}
              onCycleStatus={() => onCycleStatus(item.id)}
            />
          ))
        ) : activeTab === "expressions" ? (
          <div className="rounded-xl border border-dashed border-[#dac8ff] bg-[#fbf8ff] p-6 text-center text-sm font-bold text-muted-foreground">
            当前句暂未识别到地道表达。
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[#dac8ff] bg-[#fbf8ff] p-6 text-center text-sm font-bold text-muted-foreground">
            当前筛选下没有卡片。
          </div>
        )}
      </div>
    </aside>
  );
}

function StudyCard({
  item,
  status,
  onRead,
  onSpeak,
  onCycleStatus,
}: {
  item: StudyItem;
  status?: StudyStatus;
  onRead: () => void;
  onSpeak: () => void;
  onCycleStatus: () => void;
}) {
  return (
    <article
      className={cn(
        "rounded-xl border border-[#f3eeff] bg-[#fbfbfb] p-4 transition-colors",
        status === "unknown" && "border-[#ffb9c8] bg-[#fff8fa]",
        status === "known" && "border-[#d8c5ff] bg-[#fbf8ff]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-black leading-tight text-foreground">{item.term}</h3>
          <p className="mt-1 text-xs font-bold text-[#8f5cff]">{item.pronunciation}</p>
        </div>
        <button
          type="button"
          onClick={onSpeak}
          className="rounded-lg bg-[#f2e9ff] p-2 text-[#9a63ff] transition-colors hover:bg-[#eadcff]"
          title="发音"
        >
          <Volume2 className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-3 text-sm font-black">{item.meaning}</p>
      <p className="mt-1 text-xs font-semibold text-muted-foreground">{item.hint}</p>
      <div className="mt-3 rounded-lg border-l-2 border-[#b995ff] bg-[#fbf8ff] px-3 py-2 text-sm leading-6 text-muted-foreground">
        <p className="italic text-foreground">"{item.sentence}"</p>
        {item.translation && <p className="mt-1">{item.translation}</p>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onRead}
          className="rounded-lg border border-[#eadfff] bg-white py-2 text-xs font-black transition-colors hover:bg-[#f7f0ff]"
          title="点读跳转"
        >
          点读
        </button>
        <button
          type="button"
          onClick={onCycleStatus}
          className={cn(
            "rounded-lg border border-[#eadfff] bg-white py-2 text-xs font-black transition-colors hover:bg-[#f7f0ff]",
            status === "unknown" && "border-[#ff9bb0] bg-[#fff0f5] text-[#e11d48]",
            status === "known" && "border-[#b995ff] bg-[#f2e9ff] text-[#8f5cff]"
          )}
        >
          {status === "unknown" ? "不认识" : status === "known" ? "认识" : "标记"}
        </button>
      </div>
    </article>
  );
}

function StudyTermPopover({
  item,
  status,
  position,
  onClose,
  onSpeak,
  onRead,
  onCycleStatus,
}: {
  item: StudyItem;
  status?: StudyStatus;
  position: { left: number; top: number };
  onClose: () => void;
  onSpeak: () => void;
  onRead: () => void;
  onCycleStatus: () => void;
}) {
  return (
    <div
      data-study-popover
      style={{ left: position.left, top: position.top }}
      className="fixed z-[9998] w-[280px] -translate-x-1/2 rounded-xl border border-[#eadfff] bg-white p-4 text-left shadow-[0_22px_60px_rgba(40,24,88,0.22)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-black leading-tight">{item.term}</h3>
          <p className="mt-1 text-xs font-bold text-[#8f5cff]">{item.pronunciation}</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onSpeak}
            className="rounded-lg bg-[#f2e9ff] p-1.5 text-[#9a63ff] hover:bg-[#eadcff]"
            title="发音"
          >
            <Volume2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-[#f2e9ff] hover:text-[#8f5cff]"
            title="关闭"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <p className="mt-3 text-sm font-black">{item.meaning}</p>
      <p className="mt-2 text-xs italic leading-5 text-muted-foreground">"{item.sentence}"</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onRead}
          className="rounded-lg border border-[#eadfff] py-2 text-xs font-black hover:bg-[#f7f0ff]"
          title="点读跳转"
        >
          点读
        </button>
        <button
          type="button"
          onClick={onCycleStatus}
          className={cn(
            "rounded-lg border border-[#eadfff] py-2 text-xs font-black hover:bg-[#f7f0ff]",
            status === "unknown" && "border-[#ff9bb0] bg-[#fff0f5] text-[#e11d48]",
            status === "known" && "border-[#b995ff] bg-[#f2e9ff] text-[#8f5cff]"
          )}
        >
          {status === "unknown" ? "不认识" : status === "known" ? "认识" : "标记"}
        </button>
      </div>
    </div>
  );
}

function BlurredSubtitle({
  hidden,
  compact,
  children,
}: {
  hidden: boolean;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("relative", hidden && "select-none")}>
      <div className={cn("transition-all duration-200", hidden && "opacity-65 blur-[5px]")}>
        {children}
      </div>
      {hidden && (
        <BlindCover
          className={cn(
            "absolute inset-[-4px]",
            compact ? "rounded-md bg-white/90" : "rounded-lg bg-white/90"
          )}
        />
      )}
    </div>
  );
}

function BlindCover({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "pointer-events-none rounded-md border-2 border-dashed border-foreground/50 bg-white/90 shadow-soft backdrop-blur-[7px]",
        className
      )}
    />
  );
}

function ToolbarButton({
  children,
  onClick,
  title,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1 rounded-lg px-2.5 transition-colors hover:bg-[#f2e9ff]",
        active ? "bg-[#f2e9ff] text-[#8f5cff]" : "text-[#b695ff]"
      )}
    >
      {children}
    </button>
  );
}

function ControlButton({
  children,
  onClick,
  title,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn(
        "flex h-10 items-center gap-1 rounded-md border-2 border-foreground px-2.5 font-bold shadow-soft transition-all hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none",
        active ? "bg-brand text-foreground" : "bg-white text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
