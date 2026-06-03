"use client";

import { cn } from "@/lib/utils";
import type { AgentActivityEvent } from "@/lib/demo-types";

export function AgentActivityLog({
  events,
  visibleCount,
}: {
  events: AgentActivityEvent[];
  visibleCount: number;
}) {
  return (
    <ol className="space-y-3">
      {events.map((event, index) => {
        const visible = index < visibleCount;
        return (
          <li
            key={event.id}
            className={cn(
              "flex gap-3 rounded-lg border px-3 py-2 text-sm transition-opacity",
              visible ? "opacity-100" : "opacity-30",
              event.tone === "success" && visible && "border-primary/40 bg-primary/5",
              event.tone === "reject" && visible && "border-destructive/30 bg-destructive/5",
            )}
          >
            <span
              className={cn(
                "mt-0.5 size-2 shrink-0 rounded-full",
                !visible && "bg-muted-foreground/40",
                visible && event.tone === "success" && "bg-primary",
                visible && event.tone === "reject" && "bg-destructive",
                visible && (!event.tone || event.tone === "info") && "bg-muted-foreground",
              )}
            />
            <div className="min-w-0">
              <p className="font-medium">{event.label}</p>
              {event.detail ? <p className="text-muted-foreground text-xs">{event.detail}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
