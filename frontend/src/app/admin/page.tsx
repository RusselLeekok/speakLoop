"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clapperboard, FileClock, Plus } from "lucide-react";

import { PendingLink } from "@/components/pending-link";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import type { AdminStats } from "@/lib/types";
import { formatDate, formatDuration } from "@/lib/utils";

export default function AdminDashboardPage() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => api.get<AdminStats>("/api/admin/stats"),
  });

  const cards = [
    { label: "视频总数", value: stats?.total, icon: Clapperboard, tint: "bg-brand/10 text-foreground" },
    { label: "已发布", value: stats?.published, icon: CheckCircle2, tint: "bg-emerald-100 text-emerald-800" },
    { label: "待处理", value: (stats?.ready ?? 0) + (stats?.draft ?? 0), icon: FileClock, tint: "bg-accent/58 text-foreground" },
    { label: "解析失败", value: stats?.failed, icon: AlertTriangle, tint: "bg-red-100 text-red-800" },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="swiss-label text-brand">Dashboard</div>
          <h1 className="mt-1 text-4xl font-black tracking-[-0.02em]">内容概览</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-muted-foreground">
            管理视频、字幕和发布状态。优先处理待发布与解析失败的素材。
          </p>
        </div>
        <Button variant="brand" asChild>
          <PendingLink href="/admin/videos/new">
            <Plus />
            新增视频
          </PendingLink>
        </Button>
      </div>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="统计数据">
        {cards.map((c) => (
          <Card key={c.label} className="transition-all hover:-translate-y-0.5 hover:shadow-elevated">
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="swiss-label text-muted-foreground">{c.label}</p>
                {isLoading ? (
                  <Skeleton className="mt-2 h-8 w-14" />
                ) : (
                  <p className="mt-1 text-4xl font-black tracking-[-0.02em] tabular-nums">{c.value ?? 0}</p>
                )}
              </div>
              <span className={`flex h-11 w-11 items-center justify-center rounded-md border border-foreground/10 shadow-sm ${c.tint}`}>
                <c.icon className="h-5 w-5" />
              </span>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 border-b border-foreground/10">
          <div>
            <CardTitle className="text-xl">最近上传</CardTitle>
            <p className="mt-1 text-sm font-semibold text-muted-foreground">快速进入最近素材的编辑和字幕检查。</p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <PendingLink href="/admin/videos">查看全部</PendingLink>
          </Button>
        </CardHeader>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          ) : stats && stats.recent.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>标题</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>时长</TableHead>
                  <TableHead>字幕</TableHead>
                  <TableHead>创建时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.recent.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>
                      <PendingLink href={`/admin/videos/${v.id}/edit`} className="font-black text-foreground underline-offset-4 hover:text-brand hover:underline">
                        {v.title}
                      </PendingLink>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={v.status} />
                    </TableCell>
                    <TableCell className="tabular-nums">{formatDuration(v.duration)}</TableCell>
                    <TableCell>{v.subtitle_count} 句</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(v.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="doodle-note py-12 text-center">
              <p className="text-sm font-bold text-foreground">还没有视频。先上传一条素材，首页就会有内容可练。</p>
              <Button className="mt-4" variant="brand" asChild>
                <PendingLink href="/admin/videos/new">新增视频</PendingLink>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
