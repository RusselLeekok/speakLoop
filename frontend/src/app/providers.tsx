"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { NavigationFeedbackProvider } from "@/components/navigation-feedback";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            staleTime: 30_000,
          },
        },
      })
  );
  return (
    <QueryClientProvider client={client}>
      <NavigationFeedbackProvider>{children}</NavigationFeedbackProvider>
    </QueryClientProvider>
  );
}
