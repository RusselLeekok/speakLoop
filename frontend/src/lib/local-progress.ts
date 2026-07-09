"use client";

/** 未登录用户的学习进度保存在 localStorage；登录用户走后端接口。 */

export interface LocalProgress {
  last_time_ms: number;
  last_subtitle_id: number | null;
  updated_at: string;
}

const KEY = "speakloop-progress";

function readAll(): Record<string, LocalProgress> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function getLocalProgress(videoId: number): LocalProgress | null {
  return readAll()[String(videoId)] ?? null;
}

export function getAllLocalProgress(): Record<string, LocalProgress> {
  return readAll();
}

export function saveLocalProgress(
  videoId: number,
  lastTimeMs: number,
  lastSubtitleId: number | null
): void {
  const all = readAll();
  all[String(videoId)] = {
    last_time_ms: lastTimeMs,
    last_subtitle_id: lastSubtitleId,
    updated_at: new Date().toISOString(),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // 存储满等异常直接忽略
  }
}
