"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Clapperboard, LayoutDashboard, LogOut, MonitorPlay, Radio } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/lib/auth";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin", label: "概览", icon: LayoutDashboard, exact: true },
  { href: "/admin/videos", label: "视频管理", icon: Clapperboard, exact: false },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, hydrated, logout } = useAuthStore();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isLoginPage = pathname === "/admin/login";
  const ready = mounted && hydrated;
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (ready && !isLoginPage && !isAdmin) router.replace("/admin/login");
  }, [ready, isLoginPage, isAdmin, router]);

  if (isLoginPage) return <>{children}</>;

  if (!ready || !isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-aurora text-sm font-bold text-muted-foreground">
        正在校验管理员身份...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-aurora">
      <header className="sticky top-0 z-40 border-b border-foreground/10 bg-background/80 backdrop-blur-xl">
        <div className="container flex h-16 items-center justify-between gap-4">
          <Link href="/admin" className="flex items-center gap-2.5 text-lg font-black tracking-tight">
            <span className="wave-field liquid-accent flex h-10 w-10 items-center justify-center">
              <Radio className="relative z-10 h-4 w-4" />
            </span>
            SpeakLoop 后台
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="后台导航">
            {NAV.map((item) => {
              const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-bold",
                    active
                      ? "bg-foreground text-white shadow-soft"
                      : "text-muted-foreground hover:bg-white/80 hover:text-foreground hover:shadow-sm"
                  )}
                >
                  <item.icon className="h-3.5 w-3.5" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/">
                <MonitorPlay className="h-4 w-4" />
                前台
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                logout();
                router.replace("/admin/login");
              }}
            >
              <LogOut className="h-4 w-4" />
              退出
            </Button>
          </div>
        </div>
      </header>

      <main id="main-content" className="container py-8 md:py-10">
        <div className="mb-5 flex gap-2 md:hidden">
          {NAV.map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Button key={item.href} variant={active ? "secondary" : "outline"} size="sm" asChild>
                <Link href={item.href}>{item.label}</Link>
              </Button>
            );
          })}
        </div>
        {children}
      </main>
    </div>
  );
}
