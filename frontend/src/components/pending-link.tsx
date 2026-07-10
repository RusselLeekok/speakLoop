"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ComponentProps, MouseEvent } from "react";

import { useNavigationFeedback } from "@/components/navigation-feedback";

type PendingLinkProps = ComponentProps<typeof Link> & {
  showFeedback?: boolean;
};

function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function isInternalHref(href: PendingLinkProps["href"]): href is string {
  return typeof href === "string" && href.startsWith("/") && !href.startsWith("//");
}

function pathnameForHref(href: PendingLinkProps["href"]) {
  if (!isInternalHref(href) || typeof window === "undefined") return null;
  try {
    return new URL(href, window.location.origin).pathname;
  } catch {
    return null;
  }
}

export function PendingLink({
  href,
  onClick,
  onMouseEnter,
  onFocus,
  onTouchStart,
  target,
  showFeedback = true,
  ...props
}: PendingLinkProps) {
  const router = useRouter();
  const pathname = usePathname();
  const navigation = useNavigationFeedback();
  const hrefPathname = pathnameForHref(href);
  const prefetchHref = isInternalHref(href) ? href : null;

  function prefetch() {
    if (prefetchHref) router.prefetch(prefetchHref);
  }

  return (
    <Link
      {...props}
      href={href}
      target={target}
      onMouseEnter={(event) => {
        prefetch();
        onMouseEnter?.(event);
      }}
      onFocus={(event) => {
        prefetch();
        onFocus?.(event);
      }}
      onTouchStart={(event) => {
        prefetch();
        onTouchStart?.(event);
      }}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || !isPlainLeftClick(event) || target) return;
        if (showFeedback && hrefPathname && hrefPathname !== pathname) navigation.start();
      }}
    />
  );
}
