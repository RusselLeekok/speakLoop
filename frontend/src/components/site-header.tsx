"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Compass, Library, LogIn, LogOut, Radio, Settings, User as UserIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/lib/auth";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/#main-content", label: "发现素材", icon: Compass },
  { href: "/#materials", label: "视频库", icon: Library },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { user, logout, hydrated } = useAuthStore();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const showUser = mounted && hydrated;

  return (
    <header className="sticky top-0 z-40 border-b border-foreground/10 bg-background/80 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-6">
          <Link href="/" className="group flex shrink-0 items-center gap-2.5">
            <span className="wave-field liquid-accent flex h-10 w-10 items-center justify-center transition-transform group-hover:-translate-y-0.5">
              <Radio className="relative z-10 h-4 w-4" />
            </span>
            <span className="text-lg font-black tracking-tight">SpeakLoop</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="主导航">
            {LINKS.map((item) => {
              const active = pathname === "/" && item.href.includes("#main-content");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-bold text-muted-foreground hover:bg-white/76 hover:text-foreground hover:shadow-sm",
                    active && "bg-white/90 text-foreground shadow-sm"
                  )}
                >
                  <item.icon className="h-3.5 w-3.5" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <nav className="flex shrink-0 items-center gap-1.5" aria-label="账户">
          {showUser && user ? (
            <>
              <span className="hidden items-center gap-1.5 rounded-md bg-white/80 px-3 py-1.5 text-sm font-bold text-muted-foreground shadow-sm ring-1 ring-foreground/10 sm:flex">
                <UserIcon className="h-3.5 w-3.5" />
                {user.username}
              </span>
              {user.role === "admin" && (
                <Button variant="outline" size="sm" asChild>
                  <Link href="/admin">
                    <Settings className="h-4 w-4" />
                    后台
                  </Link>
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={logout}>
                <LogOut className="h-4 w-4" />
                退出
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" asChild>
              <Link href="/login">
                <LogIn className="h-4 w-4" />
                登录
              </Link>
            </Button>
          )}
        </nav>
      </div>
    </header>
  );
}
