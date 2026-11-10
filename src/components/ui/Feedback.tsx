import type { ReactNode } from "react";
import { AlertOctagon, Inbox, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-md", className)} />;
}

export function SkeletonRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-line">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 px-5 py-3.5">
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={j} className={cn("h-4", j === 0 ? "w-1/4" : "flex-1")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center px-6 py-14", className)}>
      <div className="mb-3 grid grid-cols-1 place-items-center size-11 rounded-xl border border-line bg-surface-2 text-muted">{icon ?? <Inbox className="size-5" />}</div>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="text-sm text-muted mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = "Couldn't load this data" }: { error: Error | string; onRetry?: () => void; title?: string }) {
  const msg = typeof error === "string" ? error : error.message;
  const permission = /permission|insufficient/i.test(msg);
  return (
    <EmptyState
      icon={<AlertOctagon className="size-5 text-danger" />}
      title={permission ? "You don't have access to this" : title}
      description={permission ? "Your role in this organization doesn't include this permission. Ask an owner or administrator." : msg}
      action={onRetry && <Button size="sm" onClick={onRetry}>Try again</Button>}
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-muted", className)} />;
}

export function FullPageLoader({ label = "Loading PayPilot…" }: { label?: string }) {
  return (
    <div className="min-h-dvh grid grid-cols-1 place-items-center">
      <div className="flex items-center gap-3 text-sm text-muted"><Spinner /> {label}</div>
    </div>
  );
}
