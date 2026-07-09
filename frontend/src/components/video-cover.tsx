import { Clapperboard } from "lucide-react";

import { cn } from "@/lib/utils";

export function VideoCover({
  src,
  alt,
  className,
}: {
  src: string | null;
  alt: string;
  className?: string;
}) {
  return (
    <div className={cn("relative aspect-video w-full overflow-hidden bg-secondary", className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_30%_20%,hsl(var(--brand)/0.42),transparent_34%),linear-gradient(135deg,hsl(var(--secondary)),hsl(217_24%_25%))] text-white">
          <Clapperboard className="h-9 w-9" strokeWidth={1.6} />
        </div>
      )}
    </div>
  );
}
