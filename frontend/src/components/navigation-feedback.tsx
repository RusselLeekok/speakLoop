"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";

type NavigationFeedbackContextValue = {
  pending: boolean;
  start: () => void;
  stop: () => void;
};

const NavigationFeedbackContext = createContext<NavigationFeedbackContextValue | null>(null);
const fallbackNavigationFeedback: NavigationFeedbackContextValue = {
  pending: false,
  start: () => {},
  stop: () => {},
};

export function NavigationFeedbackProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [pending, setPending] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  const clearPendingTimeout = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    clearPendingTimeout();
    setPending(false);
  }, [clearPendingTimeout]);

  const start = useCallback(() => {
    clearPendingTimeout();
    setPending(true);
    timeoutRef.current = window.setTimeout(() => setPending(false), 8000);
  }, [clearPendingTimeout]);

  useEffect(() => {
    stop();
  }, [pathname, stop]);

  useEffect(() => clearPendingTimeout, [clearPendingTimeout]);

  const value = useMemo(() => ({ pending, start, stop }), [pending, start, stop]);

  return (
    <NavigationFeedbackContext.Provider value={value}>
      {children}
      <NavigationFeedback pending={pending} />
    </NavigationFeedbackContext.Provider>
  );
}

export function useNavigationFeedback() {
  const context = useContext(NavigationFeedbackContext);
  return context ?? fallbackNavigationFeedback;
}

function NavigationFeedback({ pending }: { pending: boolean }) {
  if (!pending) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[9999] h-1 bg-foreground/10" aria-live="polite" aria-label="页面加载中">
      <div className="h-full w-2/3 origin-left animate-navigation-progress bg-brand shadow-[0_0_18px_hsl(var(--brand)/0.55)]" />
    </div>
  );
}
