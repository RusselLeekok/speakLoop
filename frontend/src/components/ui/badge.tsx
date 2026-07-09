import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-bold tracking-normal shadow-sm transition-colors",
  {
    variants: {
      variant: {
        default: "border-primary/30 bg-primary/90 text-primary-foreground",
        brand: "border-brand/30 bg-brand/90 text-brand-foreground",
        secondary: "border-amber-200 bg-accent/60 text-accent-foreground",
        outline: "border-foreground/10 bg-white/80 text-foreground",
        gray: "border-slate-200 bg-slate-100 text-slate-700",
        blue: "border-sky-200 bg-sky-100 text-sky-800",
        purple: "border-violet-200 bg-violet-100 text-violet-800",
        green: "border-emerald-200 bg-emerald-100 text-emerald-800",
        yellow: "border-amber-200 bg-amber-100 text-amber-900",
        red: "border-red-200 bg-red-100 text-red-800",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
