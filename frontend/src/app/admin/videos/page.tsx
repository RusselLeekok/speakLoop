"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Captions, Pencil, Plus, Search, Trash2 } from "lucide-react";

import { PendingLink } from "@/components/pending-link";
import { StatusBadge } from "@/components/status-badge";
import { VideoCover } from "@/components/video-cover";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import type { VideoAdmin, VideoAdminList, VideoStatus } from "@/lib/types";
import { cn, formatDate, formatDuration } from "@/lib/utils";

const STATUS_FILTERS: { value: VideoStatus | ""; label: string }[] = [
  { value: "", label: "全部" },
  { value: "processing", label: "处理中" },
  { value: "needs_subtitle", label: "待处理字幕" },
  { value: "ready", label: "待发布" },
  { value: "published", label: "已发布" },
  { value: "unpublished", label: "已下架" },
  { value: "failed", label: "解析失败" },
  { value: "draft", label: "草稿" },
];

const PAGE_SIZE = 10;

export default function AdminVideosPage() {
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<VideoStatus | "">("");
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<VideoAdmin | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-videos", search, status, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
      if (search) params.set("keyword", search);
      if (status) params.set("status", status);
      return api.get<VideoAdminList>(`/api/admin/videos?${params}`);
    },
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-videos"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
  };

  const statusMutation = useMutation({
    mutationFn: ({ id, newStatus }: { id: number; newStatus: VideoStatus }) => api.put(`/api/admin/videos/${id}`, { status: newStatus }),
    onSuccess: invalidate,
    onError: (e) => setActionError(e instanceof Error ? e.message : "操作失败"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/api/admin/videos/${id}`),
    onSuccess: () => {
      setDeleteTarget(null);
      invalidate();
    },
    onError: (e) => setActionError(e instanceof Error ? e.message : "删除失败"),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="mx-auto max-w-7xl space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="swiss-label text-brand">Library admin</div>
          <h1 className="mt-1 text-4xl font-black tracking-[-0.02em]">视频管理</h1>
          <p className="mt-2 text-sm font-semibold text-muted-foreground">共 {data?.total ?? "..."} 个视频</p>
        </div>
        <Button variant="brand" asChild>
          <PendingLink href="/admin/videos/new">
            <Plus />
            新增视频
          </PendingLink>
        </Button>
      </div>

      <section className="surface flex flex-wrap items-center gap-3 p-4" aria-label="视频筛选">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(keyword.trim());
            setPage(1);
          }}
        >
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索标题 / 简介" className="w-64 pl-9" />
          </div>
          <Button type="submit" variant="outline">搜索</Button>
        </form>
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => {
                setStatus(f.value);
                setPage(1);
              }}
              className={cn(
                "rounded-md px-3.5 py-1.5 text-xs font-bold transition-all hover:-translate-y-0.5 active:translate-y-px",
                status === f.value
                  ? "bg-foreground text-white shadow-soft"
                  : "bg-white/70 text-muted-foreground ring-1 ring-foreground/10 hover:bg-white hover:text-foreground hover:shadow-sm"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </section>

      {actionError && (
        <div className="rounded-md border border-destructive/24 bg-red-50 px-4 py-3 text-sm font-bold text-destructive shadow-sm">
          {actionError}
          <button className="ml-3 underline" onClick={() => setActionError(null)}>关闭</button>
        </div>
      )}

      <section className="surface overflow-hidden p-3" aria-label="视频列表">
        {isLoading ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : data && data.items.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">封面</TableHead>
                <TableHead>标题</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>时长</TableHead>
                <TableHead>字幕</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((v) => {
                const tags = v.tags?.length ? v.tags : v.category ? [v.category] : [];
                return (
                  <TableRow key={v.id}>
                    <TableCell>
                      <VideoCover src={v.cover_url} alt={v.title} className="w-24 rounded-md border border-foreground/10" />
                    </TableCell>
                    <TableCell className="max-w-64">
                      <p className="truncate font-black">{v.title}</p>
                      <p className="truncate text-xs font-semibold text-muted-foreground">
                        {tags.join(" / ") || "未标记"}
                      </p>
                    </TableCell>
                    <TableCell><StatusBadge status={v.status} /></TableCell>
                    <TableCell className="tabular-nums">{formatDuration(v.duration)}</TableCell>
                    <TableCell>{v.subtitle_count} 句</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(v.created_at)}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1.5">
                        {(v.status === "ready" || v.status === "unpublished") && (
                          <Button size="sm" variant="brand" onClick={() => statusMutation.mutate({ id: v.id, newStatus: "published" })} disabled={statusMutation.isPending}>发布</Button>
                        )}
                        {v.status === "published" && (
                          <Button size="sm" variant="outline" onClick={() => statusMutation.mutate({ id: v.id, newStatus: "unpublished" })} disabled={statusMutation.isPending}>下架</Button>
                        )}
                        <Button size="sm" variant="ghost" asChild title="字幕预览">
                          <PendingLink href={`/admin/videos/${v.id}/subtitles`}><Captions className="h-4 w-4" /></PendingLink>
                        </Button>
                        <Button size="sm" variant="ghost" asChild title="编辑">
                          <PendingLink href={`/admin/videos/${v.id}/edit`}><Pencil className="h-4 w-4" /></PendingLink>
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" title="删除" onClick={() => setDeleteTarget(v)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <div className="doodle-note py-16 text-center text-sm font-bold text-foreground">
            {search || status ? "没有匹配的视频。" : "还没有视频。"}
          </div>
        )}
      </section>

      {data && totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm font-bold">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
          <span className="text-muted-foreground">{page} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>下一页</Button>
        </div>
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除视频</DialogTitle>
            <DialogDescription>
              确定删除“{deleteTarget?.title}”吗？视频文件、封面、字幕和学习进度都会被永久删除，无法恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button variant="destructive" disabled={deleteMutation.isPending} onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}>
              {deleteMutation.isPending ? "删除中..." : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
