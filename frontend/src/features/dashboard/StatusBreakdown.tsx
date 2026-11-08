// Reparto del catalogo por estado.
//
// Una sola barra apilada en vez de cuatro contadores: lo que importa de un archivo
// no es cuantos hay de cada cosa, sino que proporcion esta sana. Los colores salen
// del mismo mapa que la tabla, asi que un tramo verde aqui y una fila verde alli
// significan lo mismo.

import { cn } from "@hyperloopupv/frontend-kit/lib";
import { Link } from "react-router-dom";
import { formatCount } from "../../lib/format";
import { statusStyles, STATUS_ORDER } from "../catalog/statusStyles";

export function StatusBreakdown({
  byStatus,
}: {
  byStatus: Record<string, number>;
}) {
  const entries = STATUS_ORDER.map((status) => ({
    status,
    style: statusStyles[status],
    count: byStatus[status] ?? 0,
  }));
  const total = entries.reduce((sum, entry) => sum + entry.count, 0);

  if (total === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-xs">
        Nothing catalogued yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-muted flex h-2 w-full overflow-hidden rounded-full">
        {entries
          .filter((entry) => entry.count > 0)
          .map((entry) => (
            <div
              key={entry.status}
              className={cn("h-full", entry.style.markClass)}
              style={{ width: `${(entry.count / total) * 100}%` }}
              title={`${entry.style.label}: ${entry.count}`}
            />
          ))}
      </div>

      <ul className="flex flex-col gap-1">
        {entries.map((entry) => (
          <li key={entry.status}>
            <Link
              to={`/catalog?status=${entry.status}`}
              className="hover:bg-muted/40 flex items-baseline justify-between rounded px-1 py-0.5 text-xs transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    entry.style.markClass,
                    entry.count === 0 && "opacity-30",
                  )}
                />
                <span
                  className={cn(
                    "text-muted-foreground",
                    entry.count === 0 && "opacity-50",
                  )}
                >
                  {entry.style.label}
                </span>
              </span>
              <span className="tabular-nums">
                {formatCount(entry.count)}
                <span className="text-muted-foreground ml-1 text-[10px]">
                  {Math.round((entry.count / total) * 100)}%
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
