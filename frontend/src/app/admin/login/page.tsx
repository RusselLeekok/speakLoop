"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import type { LoginResponse } from "@/lib/types";

export default function AdminLoginPage() {
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
      if (res.user.role !== "admin") {
        setError("该账号不是管理员，无法进入后台。");
        return;
      }
      setAuth(res.access_token, res.user);
      router.push("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败，请检查账号和密码。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-auth-glow px-4 py-10">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          返回前台
        </Link>
        <Card className="animate-fade-up">
          <CardHeader className="border-b border-foreground/10">
            <span className="liquid-accent mb-3 flex h-12 w-12 items-center justify-center">
              <ShieldCheck className="h-6 w-6" />
            </span>
            <div className="swiss-label text-brand">Admin</div>
            <CardTitle>管理员登录</CardTitle>
            <CardDescription>进入 SpeakLoop 内容管理后台。</CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
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
                {loading ? "登录中..." : "登录后台"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
