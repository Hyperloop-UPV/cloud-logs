// Estado de las subidas en curso y de las que ya han terminado.
//
// La barra de progreso solo cubre la transferencia a Drive, que es la parte larga;
// las dos llamadas de metadatos son instantaneas al lado. Se dice "Verifying" en la
// fase final para que un 100% que todavia no ha acabado no parezca colgado.

import { Card, CardContent } from "@hyperloopupv/frontend-kit/components";
import { cn } from "@hyperloopupv/frontend-kit/lib";
import { Link } from "react-router-dom";
import { formatBytes } from "../../lib/format";
import type { UploadItem, UploadPhase } from "./useUploadQueue";

const PHASE_LABEL: Record<UploadPhase, string> = {
  queued: "Starting…",
  uploading: "Uploading",
  finishing: "Verifying…",
  done: "Ready",
  failed: "Failed",
  cancelled: "Cancelled",
};

const BAR_CLASS: Record<UploadPhase, string> = {
  queued: "bg-muted-foreground/40",
  uploading: "bg-primary",
  finishing: "bg-primary",
  done: "bg-emerald-500",
  failed: "bg-red-500",
  cancelled: "bg-zinc-500",
};

export function UploadQueue({
  items,
  onCancel,
  onDismiss,
}: {
  items: UploadItem[];
  onCancel: (key: string) => void;
  onDismiss: (key: string) => void;
}) {
  return (
    <Card className="gap-3 py-4">
      <CardContent className="px-4">
        <p className="text-muted-foreground mb-2 text-xs font-medium tracking-widest uppercase">
          Transfers
        </p>
        <ul className="flex flex-col">
          {items.map((item) => {
            const running =
              item.phase === "queued" || item.phase === "uploading";
            return (
              <li
                key={item.key}
                className="flex flex-col gap-1 border-b py-2 last:border-b-0"
              >
                <div className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {item.fileName}
                  </span>
                  <span className="text-muted-foreground shrink-0 font-mono tabular-nums">
                    {formatBytes(item.fileSize)}
                  </span>
                  <span
                    className={cn(
                      "w-20 shrink-0 text-right text-[11px]",
                      item.phase === "failed" && "text-destructive",
                      item.phase === "done" &&
                        "text-emerald-600 dark:text-emerald-400",
                      running && "text-muted-foreground tabular-nums",
                    )}
                  >
                    {item.phase === "uploading"
                      ? `${Math.round(item.progress * 100)}%`
                      : PHASE_LABEL[item.phase]}
                  </span>

                  {running ? (
                    <button
                      type="button"
                      onClick={() => onCancel(item.key)}
                      className="text-muted-foreground hover:text-destructive shrink-0 text-[11px] underline underline-offset-2"
                    >
                      cancel
                    </button>
                  ) : item.phase === "done" && item.logId ? (
                    <Link
                      to={`/catalog?log=${item.logId}`}
                      className="text-muted-foreground hover:text-foreground shrink-0 text-[11px] underline underline-offset-2"
                    >
                      view
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onDismiss(item.key)}
                      className="text-muted-foreground hover:text-foreground shrink-0 text-[11px] underline underline-offset-2"
                    >
                      dismiss
                    </button>
                  )}
                </div>

                <div className="bg-muted h-1 w-full overflow-hidden rounded-full">
                  <div
                    className={cn(
                      "h-full transition-[width] duration-200",
                      BAR_CLASS[item.phase],
                    )}
                    style={{
                      width: `${Math.round((item.phase === "done" ? 1 : item.progress) * 100)}%`,
                    }}
                  />
                </div>

                {item.error && (
                  <p className="text-destructive text-[11px]">{item.error}</p>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
