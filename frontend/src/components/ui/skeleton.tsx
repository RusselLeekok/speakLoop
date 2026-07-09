import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-white/80 shadow-sm ring-1 ring-foreground/10", className)} {...props} />;
}

export { Skeleton };
