// Ultimos logs registrados.
//
// Es la respuesta a "que ha pasado desde la ultima vez que mire", que es con lo que
// uno entra a un archivo. Cada linea abre su detalle en el catalogo, con el id en la
// query string, igual que al pinchar una fila de la tabla.

import { Skeleton } from "@hyperloopupv/frontend-kit/components";
import { cn } from "@hyperloopupv/frontend-kit/lib";
import { Link } from "react-router-dom";
import type { Log } from "../../api/types";
import { formatBytes, formatRelative, formatDateTime } from "../../lib/format";
import { statusStyle } from "../catalog/statusStyles";

export function RecentActivity({
  logs,
  isPending,
  error,
  onRetry,
}: {
  logs: Log[];
  isPending?: boolean;
  error?: unknown;
  onRetry?: () => void;
}) {
  // Un fallo de red no es un catalogo vacio. Enseñar "No logs yet" cuando en
  // realidad la consulta se cayo le miente al usuario sobre el estado del archivo.
  if (error) {
    return (
      <div className="py-6 text-center">
        <p className="text-destructive text-xs">
          {error instanceof Error
            ? error.message
            : "Recent activity could not be loaded."}
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="text-muted-foreground hover:text-foreground mt-1 text-[11px] underline underline-offset-2"
          >
            try again
          </button>
        )}
      </div>
    );
  }

  if (isPending) {
    return (
      <ul className="flex flex-col">
        {Array.from({ length: 5 }, (_, i) => (
          <li
            key={i}
            className="flex items-center gap-2 border-b py-2 last:border-b-0"
          >
            <Skeleton className="size-2 shrink-0 rounded-full" />
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3 w-16" />
          </li>
        ))}
      </ul>
    );
  }

  if (logs.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-xs">
        No logs yet.
      </p>
    );
  }

  return (
    <ul className="flex flex-col">
      {logs.map((log) => {
        const style = statusStyle(log.status);
        return (
          <li key={log.id} className="border-b last:border-b-0">
            <Link
              to={`/catalog?log=${log.id}`}
              className="hover:bg-muted/30 flex items-center gap-2 px-1 py-2 text-xs transition-colors"
            >
              <span
                className={cn("size-2 shrink-0 rounded-full", style.markClass)}
                title={style.description}
              />
              <span className="min-w-0 flex-1 truncate" title={log.fileName}>
                {log.fileName}
              </span>
              <span className="text-muted-foreground shrink-0 font-mono tabular-nums">
                {formatBytes(log.fileSize)}
              </span>
              <span
                className="text-muted-foreground w-24 shrink-0 text-right"
                title={formatDateTime(log.createdAt)}
              >
                {formatRelative(log.createdAt)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
