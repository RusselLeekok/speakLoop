"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Radio } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import type { LoginResponse } from "@/lib/types";

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.post<LoginResponse>("/api/auth/login", { username, password });
      setAuth(res.access_token, res.user);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败，请检查账号和密码。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-auth-glow px-4 py-10">
      <div className="grid w-full max-w-4xl items-stretch overflow-hidden rounded-lg border border-foreground/10 bg-white/60 shadow-elevated backdrop-blur-xl md:grid-cols-[1fr_0.9fr]">
        <section className="hidden flex-col justify-between bg-secondary p-8 text-white md:flex">
          <div>
            <span className="wave-field liquid-accent flex h-12 w-12 items-center justify-center">
              <Radio className="relative z-10 h-5 w-5" />
            </span>
            <h1 className="mt-8 text-4xl font-black leading-tight tracking-[-0.02em]">
              把英语素材练成条件反射
            </h1>
            <p className="mt-4 max-w-sm text-sm font-semibold leading-7 text-white/70">
              登录后会同步学习进度、收藏和练习记录。也可以先返回首页直接开始练。
            </p>
          </div>
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-bold text-white/80 hover:text-white">
            <ArrowLeft className="h-4 w-4" />
            返回素材库
          </Link>
        </section>

        <Card className="border-0 bg-transparent shadow-none">
          <CardHeader>
            <div className="swiss-label text-brand">Account</div>
            <CardTitle>登录 SpeakLoop</CardTitle>
            <CardDescription>继续从上一句开始，保留你的学习节奏。</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">用户名</Label>
                <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">密码</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
              </div>
              {error && (
                <p className="rounded-md border border-destructive/22 bg-red-50 px-3 py-2 text-sm font-bold text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" variant="brand" className="w-full" disabled={loading}>
                {loading ? "登录中..." : "登录"}
              </Button>
              <p className="text-center text-xs font-semibold leading-relaxed text-muted-foreground md:hidden">
                <Link href="/" className="text-brand underline underline-offset-4">
                  返回首页
                </Link>
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
