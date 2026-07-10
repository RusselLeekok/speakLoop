"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Bell,
  BookOpen,
  Captions,
  ChevronLeft,
  ChevronRight,
  Clock,
  Filter,
  Home,
  Library,
  LogIn,
  LogOut,
  Menu,
  Radio,
  Search,
  Settings,
  Sparkles,
  User as UserIcon,
  X,
} from "lucide-react";

import { VideoCover } from "@/components/video-cover";
import { PendingLink } from "@/components/pending-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import { getAllLocalProgress, type LocalProgress } from "@/lib/local-progress";
import { prewarmRoutes } from "@/lib/route-prewarm";
import type { Progress, VideoPublic } from "@/lib/types";
import { cn, formatDuration } from "@/lib/utils";

type WorkspaceView = "discover" | "library" | "study" | "intensive" | "words";

const fallbackCategories = ["热门", "基础口语", "电影精选", "商业演讲"];
const durationFilters = [
  { value: "all", label: "全部时长" },
  { value: "short", label: "10 分钟内" },
  { value: "medium", label: "10-20 分钟" },
  { value: "long", label: "20 分钟以上" },
] as const;
const progressFilters = [
  { value: "all", label: "全部进度" },
  { value: "learning", label: "学习中" },
  { value: "fresh", label: "未开始" },
] as const;

type DurationFilter = (typeof durationFilters)[number]["value"];
type ProgressFilter = (typeof progressFilters)[number]["value"];
type ProgressRecord = Pick<Progress, "video_id" | "last_time_ms" | "last_subtitle_id" | "updated_at">;

const topNav = [
  { label: "首页", href: "/", view: "discover" },
  { label: "视频库", href: "/library", view: "library" },
  { label: "我的学习", href: "/study", view: "study" },
] as const;

const sideNav = [
  { label: "首页", href: "/", view: "discover", icon: Home },
  { label: "视频库", href: "/library", view: "library", icon: Library },
  { label: "精听", href: "/intensive", view: "intensive", icon: BookOpen },
  { label: "生词卡", href: "/words", view: "words", icon: Sparkles },
  { label: "我的", href: "/study", view: "study", icon: UserIcon },
] as const;

const viewCopy: Record<WorkspaceView, { eyebrow: string; title: string; description: string }> = {
  discover: {
    eyebrow: "探索",
    title: "探索英语视频",
    description: "精选优质英语视频，边听边练句子、词汇和表达。",
  },
  library: {
    eyebrow: "视频库",
    title: "全部英语素材",
    description: "按主题、时长和学习进度筛选，快速找到下一条可练的视频。",
  },
  study: {
    eyebrow: "我的学习",
    title: "继续你的学习节奏",
    description: "查看已开始学习的视频；点击左侧日期可以定位某一天的练习记录。",
  },
  intensive: {
    eyebrow: "精听",
    title: "适合精听的素材",
    description: "优先展示带字幕的视频，进入播放页后可逐句跟听、点读和精读。",
  },
  words: {
    eyebrow: "生词卡",
    title: "生词卡片",
    description: "这里会汇集你在播放页精读和标记的单词短语。",
  },
};

function formatDateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function monthLabel(date: Date) {
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "short" });
}

function sameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function localProgressToRows(progress: Record<string, LocalProgress>): ProgressRecord[] {
  return Object.entries(progress).map(([videoId, row]) => ({
    video_id: Number(videoId),
    last_time_ms: row.last_time_ms,
    last_subtitle_id: row.last_subtitle_id,
    updated_at: row.updated_at,
  }));
}

function progressDateKey(row: ProgressRecord) {
  const date = new Date(row.updated_at);
  if (Number.isNaN(date.getTime())) return null;
  return formatDateKey(date);
}

export function LearningWorkspace({ view }: { view: WorkspaceView }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedDate = searchParams.get("date");
  const [keyword, setKeyword] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [duration, setDuration] = useState<DurationFilter>("all");
  const [progressFilter, setProgressFilter] = useState<ProgressFilter>("all");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [localProgress, setLocalProgress] = useState<Record<string, LocalProgress>>({});
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const parsed = selectedDate ? new Date(`${selectedDate}T00:00:00`) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  });
  const { token, user, logout, hydrated } = useAuthStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setLocalProgress(getAllLocalProgress());
  }, []);

  useEffect(() => {
    if (!selectedDate) return;
    const parsed = new Date(`${selectedDate}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) setCalendarMonth(parsed);
  }, [selectedDate]);

  const showUser = mounted && hydrated;

  useEffect(() => {
    if (!showUser || user?.role !== "admin") return;
    router.prefetch("/admin");
    router.prefetch("/admin/videos");
    router.prefetch("/admin/videos/new");
    prewarmRoutes(["/admin", "/admin/videos", "/admin/videos/new"]);
  }, [router, showUser, user?.role]);

  useEffect(() => {
    ["/", "/library", "/study", "/intensive", "/words"].forEach((path) => router.prefetch(path));
    prewarmRoutes(["/", "/library", "/study", "/intensive", "/words"]);
  }, [router]);

  const { data: videos, isError, isLoading } = useQuery({
    queryKey: ["videos", search, category],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set("keyword", search);
      if (category) params.set("category", category);
      const qs = params.toString();
      return api.get<VideoPublic[]>(`/api/videos${qs ? `?${qs}` : ""}`);
    },
    placeholderData: keepPreviousData,
    retry: false,
  });

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<string[]>("/api/videos/categories"),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const { data: serverProgress } = useQuery({
    queryKey: ["my-progress", token],
    queryFn: () => api.get<Progress[]>("/api/progress"),
    enabled: !!token,
    placeholderData: keepPreviousData,
  });

  const rawVideos = videos ?? [];
  const progressRows = useMemo<ProgressRecord[]>(
    () => (token ? serverProgress ?? [] : localProgressToRows(localProgress)),
    [localProgress, serverProgress, token]
  );
  const progressByVideo = useMemo(() => {
    const map = new Map<number, ProgressRecord>();
    progressRows.forEach((row) => map.set(row.video_id, row));
    return map;
  }, [progressRows]);
  const progressDates = useMemo(() => {
    const dates = new Set<string>();
    progressRows.forEach((row) => {
      if (row.last_time_ms <= 3000) return;
      const key = progressDateKey(row);
      if (key) dates.add(key);
    });
    return dates;
  }, [progressRows]);

  const categoryOptions = categories && categories.length > 0 ? categories : fallbackCategories;
  const getProgressRow = (video: VideoPublic) => progressByVideo.get(video.id);
  const getProgressMs = (video: VideoPublic) => getProgressRow(video)?.last_time_ms ?? 0;
  const activeFilterCount = [category, duration !== "all", progressFilter !== "all"].filter(Boolean).length;

  const visibleVideos = useMemo(() => {
    return rawVideos.filter((video) => {
      const progress = progressByVideo.get(video.id);
      const progressMs = progress?.last_time_ms ?? 0;
      const hasProgress = progressMs > 3000;
      const minutes = (video.duration ?? 0) / 60;

      if (view === "study" && !hasProgress) return false;
      if (view === "study" && selectedDate && progressDateKey(progress ?? ({ updated_at: "" } as ProgressRecord)) !== selectedDate) {
        return false;
      }
      if (view === "intensive" && video.subtitle_count <= 0) return false;
      if (view === "words") return false;
      if (duration === "short" && !(minutes > 0 && minutes < 10)) return false;
      if (duration === "medium" && !(minutes >= 10 && minutes <= 20)) return false;
      if (duration === "long" && !(minutes > 20)) return false;
      if (progressFilter === "learning" && !hasProgress) return false;
      if (progressFilter === "fresh" && hasProgress) return false;
      return true;
    });
  }, [rawVideos, progressByVideo, view, selectedDate, duration, progressFilter]);

  const learnedCount = useMemo(
    () => rawVideos.filter((video) => (progressByVideo.get(video.id)?.last_time_ms ?? 0) > 3000).length,
    [progressByVideo, rawVideos]
  );
  const totalMinutes = useMemo(
    () => progressRows.reduce((sum, row) => sum + Math.max(0, row.last_time_ms) / 60000, 0),
    [progressRows]
  );

  const resetFilters = () => {
    setCategory(null);
    setDuration("all");
    setProgressFilter("all");
  };

  function navigateToDate(date: Date) {
    router.push(`/study?date=${formatDateKey(date)}`);
  }

  function handleLogout() {
    logout();
    setNotificationsOpen(false);
    setMobileNavOpen(false);
    router.refresh();
  }

  const copy = viewCopy[view];
  const hasFilter = !!(search || activeFilterCount || selectedDate);

  return (
    <div className="min-h-screen bg-aurora text-foreground">
      <div className="flex min-h-screen">
        <LearningSidebar
          pathname={pathname}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((prev) => !prev)}
          learnedCount={learnedCount}
          videoCount={rawVideos.length}
          minutes={Math.round(totalMinutes)}
          progressDates={progressDates}
          selectedDate={selectedDate}
          month={calendarMonth}
          setMonth={setCalendarMonth}
          onDateClick={navigateToDate}
          showUser={showUser}
          userName={user?.username}
          isAdmin={user?.role === "admin"}
          onLogout={handleLogout}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 border-b border-foreground/10 bg-background/90 backdrop-blur-xl">
            <div className="flex h-16 items-center gap-4 px-4 lg:px-7">
              <div className="relative lg:hidden">
                <button
                  type="button"
                  onClick={() => setMobileNavOpen((prev) => !prev)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-foreground/10 bg-white text-muted-foreground shadow-sm transition-colors hover:text-foreground"
                  title="打开导航"
                  aria-label="打开导航"
                >
                  <Menu className="h-4 w-4" />
                </button>
                {mobileNavOpen && (
                  <MobileNav pathname={pathname} onClose={() => setMobileNavOpen(false)} />
                )}
              </div>

              <nav className="hidden items-center gap-7 text-sm font-black text-muted-foreground md:flex" aria-label="顶部导航">
                {topNav.map((item) => (
                  <PendingLink
                    key={item.href}
                    href={item.href}
                    showFeedback={false}
                    className={cn(
                      "border-b-2 border-transparent py-5 transition-colors hover:text-foreground",
                      isActive(pathname, item.href) && "border-brand text-brand"
                    )}
                  >
                    {item.label}
                  </PendingLink>
                ))}
              </nav>

              <form
                className="mx-auto flex w-full max-w-xl"
                onSubmit={(e) => {
                  e.preventDefault();
                  setSearch(keyword.trim());
                }}
              >
                <div className="relative w-full">
                  <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="搜索视频或关键词..."
                    className="h-11 rounded-md border-0 bg-white pl-11 pr-4 shadow-sm ring-1 ring-foreground/10 focus-visible:ring-brand/50"
                  />
                </div>
              </form>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setNotificationsOpen((prev) => !prev)}
                  className="hidden h-10 w-10 items-center justify-center rounded-md bg-white text-muted-foreground shadow-sm ring-1 ring-foreground/10 transition-colors hover:text-foreground sm:inline-flex"
                  title="通知"
                  aria-label="通知"
                >
                  <Bell className="h-4 w-4" />
                </button>
                {notificationsOpen && (
                  <div className="absolute right-0 top-12 z-50 w-64 rounded-lg border border-foreground/10 bg-white p-4 text-sm font-semibold shadow-elevated">
                    <p className="font-black text-foreground">暂无通知</p>
                    <p className="mt-1 leading-6 text-muted-foreground">学习提醒和素材处理消息会显示在这里。</p>
                  </div>
                )}
              </div>

              {showUser && user ? (
                <PendingLink
                  href="/study"
                  showFeedback={false}
                  className="hidden h-10 min-w-10 items-center justify-center rounded-md bg-white px-3 text-sm font-black text-brand shadow-sm ring-1 ring-foreground/10 sm:inline-flex"
                  title="我的学习"
                >
                  {user.username.slice(0, 1).toUpperCase()}
                </PendingLink>
              ) : (
                <Button size="sm" variant="outline" asChild>
                  <PendingLink href="/login">
                    <LogIn className="h-4 w-4" />
                    登录
                  </PendingLink>
                </Button>
              )}
            </div>
          </header>

          <main id="main-content" className="min-w-0 flex-1 px-4 py-6 lg:px-7">
            <div className="mx-auto max-w-[1440px]">
              <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="mb-2 text-sm font-black text-brand">{copy.eyebrow}</p>
                  <h1 className="text-3xl font-black leading-tight tracking-[-0.02em] text-[#1b1d2a]">
                    {selectedDate && view === "study" ? `${selectedDate} 的学习记录` : copy.title}
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-muted-foreground">
                    {copy.description}
                  </p>
                </div>

                {view !== "words" && (
                  <div className="flex items-center gap-3">
                    <p className="hidden text-sm font-black text-foreground md:block">
                      {isError ? "素材库未连接" : isLoading ? "加载中" : `${visibleVideos.length} 个视频`}
                    </p>
                    {(view === "library" || view === "discover" || view === "study") && (
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setFiltersOpen((prev) => !prev)}
                          className={cn(
                            "inline-flex h-11 items-center gap-2 rounded-md border border-foreground/10 bg-white px-4 text-sm font-black shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
                            filtersOpen && "border-brand/40 text-brand"
                          )}
                        >
                          <Filter className="h-4 w-4" />
                          筛选
                          {activeFilterCount > 0 && (
                            <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] text-brand-foreground">
                              {activeFilterCount}
                            </span>
                          )}
                        </button>
                        {filtersOpen && (
                          <FilterPanel
                            categories={categoryOptions}
                            category={category}
                            duration={duration}
                            progressFilter={progressFilter}
                            onCategoryChange={setCategory}
                            onDurationChange={setDuration}
                            onProgressChange={setProgressFilter}
                            onReset={resetFilters}
                            onClose={() => setFiltersOpen(false)}
                          />
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {view !== "words" && (
                <div className="mb-5 flex flex-wrap items-center gap-2 text-sm font-bold text-muted-foreground">
                  <QuickTab active={category === null} onClick={() => setCategory(null)}>
                    全部
                  </QuickTab>
                  {categoryOptions.slice(0, 4).map((item) => (
                    <QuickTab key={item} active={category === item} onClick={() => setCategory(category === item ? null : item)}>
                      {item}
                    </QuickTab>
                  ))}
                </div>
              )}

              {view === "words" ? (
                <WordsEmptyState />
              ) : isLoading ? (
                <VideoGridSkeleton />
              ) : visibleVideos.length > 0 ? (
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {visibleVideos.map((video) => (
                    <VideoCard
                      key={video.id}
                      video={video}
                      progressMs={getProgressMs(video)}
                      progressDate={progressDateKey(getProgressRow(video) ?? ({ updated_at: "" } as ProgressRecord))}
                      mode={view}
                    />
                  ))}
                </div>
              ) : (
                <EmptyVideoState connectionError={isError} hasFilter={hasFilter} view={view} selectedDate={selectedDate} />
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function MobileNav({ pathname, onClose }: { pathname: string; onClose: () => void }) {
  return (
    <div className="absolute left-0 top-12 z-50 w-56 rounded-lg border border-foreground/10 bg-white p-2 shadow-elevated">
      {[...topNav, { label: "精听", href: "/intensive", view: "intensive" as const }, { label: "生词卡", href: "/words", view: "words" as const }].map((item) => (
        <PendingLink
          key={item.href}
          href={item.href}
          showFeedback={false}
          onClick={onClose}
          className={cn(
            "flex h-10 items-center rounded-md px-3 text-sm font-black text-muted-foreground hover:bg-muted/70 hover:text-foreground",
            isActive(pathname, item.href) && "bg-brand/10 text-foreground"
          )}
        >
          {item.label}
        </PendingLink>
      ))}
    </div>
  );
}

function LearningSidebar({
  pathname,
  collapsed,
  onToggle,
  learnedCount,
  videoCount,
  minutes,
  progressDates,
  selectedDate,
  month,
  setMonth,
  onDateClick,
  showUser,
  userName,
  isAdmin,
  onLogout,
}: {
  pathname: string;
  collapsed: boolean;
  onToggle: () => void;
  learnedCount: number;
  videoCount: number;
  minutes: number;
  progressDates: Set<string>;
  selectedDate: string | null;
  month: Date;
  setMonth: (date: Date) => void;
  onDateClick: (date: Date) => void;
  showUser: boolean;
  userName?: string;
  isAdmin: boolean;
  onLogout: () => void;
}) {
  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 border-r border-foreground/10 bg-white/92 backdrop-blur-xl transition-[width] duration-300 lg:flex lg:flex-col",
        collapsed ? "w-[86px]" : "w-[248px]"
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="absolute -right-3 top-6 z-[60] inline-flex h-7 w-7 items-center justify-center rounded-full border border-foreground/10 bg-white text-muted-foreground shadow-soft hover:-translate-y-0.5 hover:text-foreground"
        title={collapsed ? "展开侧边栏" : "收起侧边栏"}
        aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
      >
        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
      </button>

      <div className={cn("flex h-20 items-center gap-3 px-4", collapsed && "justify-center px-0")}>
        <span className="wave-field liquid-accent flex h-11 w-11 shrink-0 items-center justify-center">
          <Radio className="relative z-10 h-4 w-4" />
        </span>
        {!collapsed && (
          <div className="min-w-0">
            <span className="block text-lg font-black tracking-tight">SpeakLoop</span>
            <span className="mt-0.5 block text-[11px] font-bold text-muted-foreground">英语精听工作台</span>
          </div>
        )}
      </div>

      <nav className={cn("space-y-1 px-3 py-2", collapsed && "px-3")} aria-label="学习导航">
        {sideNav.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.href);
          return (
            <PendingLink
              key={item.href}
              href={item.href}
              showFeedback={false}
              title={collapsed ? item.label : undefined}
              className={cn(
                "group flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-black transition-colors",
                active
                  ? "bg-brand/10 text-foreground shadow-sm ring-1 ring-brand/10"
                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                collapsed && "justify-center px-0"
              )}
            >
              <Icon className={cn("h-4 w-4 shrink-0", active && "text-brand")} />
              {!collapsed && <span>{item.label}</span>}
            </PendingLink>
          );
        })}
      </nav>

      {!collapsed && (
        <div className="mt-4 px-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-black text-muted-foreground">学习累计</p>
            <span className="rounded-md bg-brand/10 px-2 py-1 text-[10px] font-black text-foreground">本地记录</span>
          </div>
          <div className="grid gap-2">
            <SidebarStat label="已学视频" value={learnedCount} />
            <SidebarStat label="素材总数" value={videoCount} />
            <SidebarStat label="学习分钟" value={minutes} />
          </div>
          <LearningCalendar
            month={month}
            setMonth={setMonth}
            selectedDate={selectedDate}
            progressDates={progressDates}
            onDateClick={onDateClick}
          />
        </div>
      )}

      <div className={cn("mt-auto border-t border-foreground/10 p-3", collapsed && "px-2")}>
        {showUser && userName ? (
          <div className={cn("flex items-center gap-2", collapsed && "justify-center")}>
            <PendingLink
              href="/study"
              showFeedback={false}
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand/10 text-sm font-black text-foreground ring-1 ring-brand/10"
              title="我的学习"
            >
              {userName.slice(0, 1).toUpperCase()}
            </PendingLink>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black">{userName}</p>
                <div className="mt-1 flex gap-1">
                  {isAdmin && (
                    <PendingLink href="/admin" className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-bold text-muted-foreground hover:bg-muted/70 hover:text-foreground">
                      <Settings className="h-3 w-3" />
                      后台
                    </PendingLink>
                  )}
                  <button type="button" onClick={onLogout} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-bold text-muted-foreground hover:bg-muted/70 hover:text-foreground">
                    <LogOut className="h-3 w-3" />
                    退出
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <Button variant="outline" size={collapsed ? "icon" : "sm"} className="w-full" asChild>
            <PendingLink href="/login">
              <LogIn className="h-4 w-4" />
              {!collapsed && "登录"}
            </PendingLink>
          </Button>
        )}
      </div>
    </aside>
  );
}

function SidebarStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-muted/55 px-3 py-2 shadow-sm ring-1 ring-white/70">
      <span className="text-xs font-bold text-muted-foreground">{label}</span>
      <span className="min-w-7 rounded-md bg-white px-2 py-1 text-center text-xs font-black shadow-sm ring-1 ring-foreground/10">{value}</span>
    </div>
  );
}

function LearningCalendar({
  month,
  setMonth,
  selectedDate,
  progressDates,
  onDateClick,
}: {
  month: Date;
  setMonth: (date: Date) => void;
  selectedDate: string | null;
  progressDates: Set<string>;
  onDateClick: (date: Date) => void;
}) {
  const todayKey = formatDateKey(new Date());
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const startOffset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - startOffset);
  const cells = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });

  function moveMonth(offset: number) {
    setMonth(new Date(month.getFullYear(), month.getMonth() + offset, 1));
  }

  return (
    <div className="mt-5 rounded-lg border border-foreground/10 bg-white/70 p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => moveMonth(-1)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/70 hover:text-foreground"
          aria-label="上个月"
        >
          ‹
        </button>
        <span className="text-sm font-black text-foreground">{monthLabel(month)}</span>
        <button
          type="button"
          onClick={() => moveMonth(1)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/70 hover:text-foreground"
          aria-label="下个月"
        >
          ›
        </button>
      </div>
      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[10px] font-black text-muted-foreground/70">
        {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold text-muted-foreground">
        {cells.map((date) => {
          const key = formatDateKey(date);
          const active = selectedDate === key;
          const hasProgress = progressDates.has(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onDateClick(date)}
              className={cn(
                "relative flex h-7 items-center justify-center rounded-full transition-all hover:bg-brand/10 hover:text-foreground",
                !sameMonth(date, month) && "opacity-35",
                key === todayKey && "ring-1 ring-brand/40",
                active && "bg-foreground text-white hover:bg-foreground hover:text-white",
                hasProgress && !active && "bg-brand text-brand-foreground shadow-sm"
              )}
              aria-label={`${key} 学习记录`}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FilterPanel({
  categories,
  category,
  duration,
  progressFilter,
  onCategoryChange,
  onDurationChange,
  onProgressChange,
  onReset,
  onClose,
}: {
  categories: string[];
  category: string | null;
  duration: DurationFilter;
  progressFilter: ProgressFilter;
  onCategoryChange: (value: string | null) => void;
  onDurationChange: (value: DurationFilter) => void;
  onProgressChange: (value: ProgressFilter) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute right-0 top-[3.25rem] z-50 w-[min(88vw,360px)] rounded-lg border border-foreground/10 bg-white p-4 text-left shadow-elevated">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-black">筛选视频</h2>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted/70 hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <FilterGroup label="视频主题">
        <FilterPill active={category === null} onClick={() => onCategoryChange(null)}>
          全部
        </FilterPill>
        {categories.map((item) => (
          <FilterPill key={item} active={category === item} onClick={() => onCategoryChange(category === item ? null : item)}>
            {item}
          </FilterPill>
        ))}
      </FilterGroup>

      <FilterGroup label="时长">
        {durationFilters.map((item) => (
          <FilterPill key={item.value} active={duration === item.value} onClick={() => onDurationChange(item.value)}>
            {item.label}
          </FilterPill>
        ))}
      </FilterGroup>

      <FilterGroup label="学习进度">
        {progressFilters.map((item) => (
          <FilterPill key={item.value} active={progressFilter === item.value} onClick={() => onProgressChange(item.value)}>
            {item.label}
          </FilterPill>
        ))}
      </FilterGroup>

      <div className="mt-4 flex gap-2">
        <Button type="button" variant="ghost" className="flex-1" onClick={onReset}>
          重置
        </Button>
        <Button type="button" variant="brand" className="flex-1" onClick={onClose}>
          完成
        </Button>
      </div>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-foreground/10 py-4 first:border-t-0 first:pt-0">
      <p className="mb-2 text-xs font-black text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border px-3 py-2 text-xs font-black transition-all active:translate-y-px",
        active ? "border-brand/30 bg-brand/10 text-foreground" : "border-foreground/10 bg-white/80 text-muted-foreground hover:bg-white hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function QuickTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-4 py-2 transition-colors",
        active ? "bg-white text-foreground shadow-sm ring-1 ring-foreground/10" : "hover:bg-white hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function VideoGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {Array.from({ length: 9 }).map((_, index) => (
        <div key={index} className="rounded-lg bg-white p-2 shadow-sm">
          <Skeleton className="aspect-video w-full rounded-xl" />
          <div className="space-y-2 px-2 py-3">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyVideoState({
  connectionError,
  hasFilter,
  view,
  selectedDate,
}: {
  connectionError: boolean;
  hasFilter: boolean;
  view: WorkspaceView;
  selectedDate: string | null;
}) {
  const message =
    view === "study" && selectedDate
      ? `${selectedDate} 暂无学习记录`
      : view === "study"
        ? "还没有开始学习的视频"
        : view === "intensive"
          ? "还没有可精听的视频"
          : hasFilter
            ? "没有找到匹配视频"
            : "还没有公开视频";
  return (
    <div className="rounded-lg border border-dashed border-foreground/14 bg-white px-6 py-20 text-center shadow-sm">
      <h2 className="text-lg font-black">
        {connectionError ? "暂时连不上素材库" : message}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm font-medium leading-6 text-muted-foreground">
        {connectionError
          ? "启动后端服务后，这里会直接显示视频缩略图列表。"
          : view === "study"
            ? "从视频库打开一条素材并播放几秒后，它会出现在这里。"
            : hasFilter
              ? "换个关键词、分类或日期再试。"
              : "管理员发布视频后，这里会直接进入视频流。"}
      </p>
      {view === "study" && (
        <Button className="mt-5" variant="brand" asChild>
          <PendingLink href="/library">去视频库学习</PendingLink>
        </Button>
      )}
    </div>
  );
}

function WordsEmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-foreground/14 bg-white px-6 py-20 text-center shadow-sm">
      <h2 className="text-lg font-black">生词卡还在等待你的标记</h2>
      <p className="mx-auto mt-2 max-w-md text-sm font-medium leading-6 text-muted-foreground">
        当前版本还没有单词持久化数据。进入播放页打开“精读”，标记单词短语后，这里会作为统一入口展示。
      </p>
      <Button className="mt-5" variant="brand" asChild>
        <PendingLink href="/intensive">去精听素材</PendingLink>
      </Button>
    </div>
  );
}

function VideoCard({
  video,
  progressMs,
  progressDate,
  mode,
}: {
  video: VideoPublic;
  progressMs: number;
  progressDate: string | null;
  mode: WorkspaceView;
}) {
  const hasProgress = progressMs > 3000;
  const progressPercent =
    hasProgress && video.duration ? Math.min(100, (progressMs / 1000 / video.duration) * 100) : 0;
  const tags = video.tags?.length ? video.tags.slice(0, 4) : video.category ? [video.category] : [];
  const href = mode === "intensive" ? `/learn/${video.id}` : `/videos/${video.id}`;

  return (
    <PendingLink
      href={href}
      className="group block rounded-lg bg-white p-2 shadow-sm ring-1 ring-foreground/10 transition-all hover:-translate-y-1 hover:shadow-elevated"
    >
      <div className="relative overflow-hidden rounded-xl bg-secondary">
        <VideoCover src={video.cover_url} alt={video.title} className="rounded-xl" />
        {tags[0] && (
          <span className="absolute left-2 top-2 rounded-lg bg-[#1f8eea] px-2 py-1 text-[11px] font-black text-white shadow-sm">
            {tags[0].slice(0, 2)}
          </span>
        )}
        <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/70 px-2 py-0.5 text-xs font-bold text-white backdrop-blur">
          <Clock className="h-3 w-3" />
          {formatDuration(video.duration)}
        </span>
        {progressPercent > 0 && (
          <div className="absolute bottom-0 left-0 h-1.5 w-full bg-white/70">
            <div className="h-full rounded-r-full bg-brand" style={{ width: `${progressPercent}%` }} />
          </div>
        )}
      </div>

      <div className="px-2 pb-3 pt-3">
        <h2 className="line-clamp-2 min-h-[2.5rem] text-[15px] font-black leading-snug tracking-[-0.01em] text-foreground group-hover:text-brand">
          {video.title}
        </h2>
        {video.description && (
          <p className="mt-2 line-clamp-2 text-xs font-semibold leading-5 text-muted-foreground">
            {video.description}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-muted-foreground">
          <span className="flex items-center gap-1 text-[#f2a900]">★★★★★</span>
          <Badge variant="secondary">{mode === "intensive" ? "进入精听" : hasProgress ? "继续学习" : "新素材"}</Badge>
          {tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="secondary">{tag}</Badge>
          ))}
          <span className="flex items-center gap-1">
            <Captions className="h-3.5 w-3.5" />
            {video.subtitle_count} 句
          </span>
          {progressDate && mode === "study" && <span>{progressDate}</span>}
        </div>
      </div>
    </PendingLink>
  );
}
