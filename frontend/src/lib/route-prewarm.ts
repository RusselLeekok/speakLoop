"use client";

const prewarmed = new Set<string>();

export function prewarmRoute(path: string) {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined" || prewarmed.has(path)) return;
  prewarmed.add(path);
  window.setTimeout(() => {
    fetch(path, { credentials: "same-origin", cache: "no-store" }).catch(() => {
      prewarmed.delete(path);
    });
  }, 250);
}

export function prewarmRoutes(paths: string[]) {
  paths.forEach(prewarmRoute);
}
