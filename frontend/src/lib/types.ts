export type VideoStatus =
  | "draft"
  | "processing"
  | "needs_subtitle"
  | "ready"
  | "published"
  | "unpublished"
  | "failed";

export type Role = "admin" | "user";

export interface User {
  id: number;
  username: string;
  role: Role;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface VideoPublic {
  id: number;
  title: string;
  description: string | null;
  category: string | null;
  tags: string[];
  cover_url: string | null;
  duration: number | null;
  subtitle_count: number;
  published_at: string | null;
}

export interface VideoDetail extends VideoPublic {
  file_url: string;
}

export interface VideoAdmin {
  id: number;
  title: string;
  description: string | null;
  category: string | null;
  tags: string[];
  source_type: string;
  source_url: string | null;
  original_filename: string | null;
  file_url: string;
  cover_url: string | null;
  duration: number | null;
  container_format: string | null;
  file_size: number | null;
  mime_type: string | null;
  status: VideoStatus;
  error_message: string | null;
  subtitle_count: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface VideoAdminList {
  items: VideoAdmin[];
  total: number;
  page: number;
  page_size: number;
}

export interface Subtitle {
  id: number;
  video_id: number;
  start_ms: number;
  end_ms: number;
  en_text: string | null;
  zh_text: string | null;
  sort_order: number;
}

export interface SubtitleWarning {
  id: number;
  warning_type: string | null;
  message: string;
  created_at: string;
}

export interface AdminSubtitles {
  video_id: number;
  subtitle_count: number;
  subtitles: Subtitle[];
  warnings: SubtitleWarning[];
}

export interface AdminStats {
  total: number;
  published: number;
  draft: number;
  ready: number;
  unpublished: number;
  failed: number;
  recent: VideoAdmin[];
}

export interface UploadResult {
  video_id: number;
  task_id: number | null;
  title: string;
  status: VideoStatus;
  file_url: string;
  cover_url: string | null;
  subtitle_count: number;
  warnings: string[];
  message?: string | null;
}

export interface ReuploadResult {
  video_id: number;
  status: VideoStatus;
  subtitle_count: number;
  warnings: string[];
  message?: string | null;
}

export interface TaskCreated {
  task_id: number;
  video_id: number | null;
}

export interface ProcessingTask {
  id: number;
  celery_id: string | null;
  video_id: number | null;
  task_type: string;
  status: "queued" | "running" | "completed" | "failed" | string;
  progress: number;
  error_message: string | null;
  result_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface VideoTrack {
  id: number;
  video_id: number;
  track_type: "video" | "audio" | "subtitle" | string;
  stream_index: number;
  codec: string | null;
  language: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  bit_rate: number | null;
}

export interface Progress {
  video_id: number;
  last_time_ms: number;
  last_subtitle_id: number | null;
  updated_at: string;
}

export type SubtitleMode = "both" | "en" | "zh" | "hidden";
