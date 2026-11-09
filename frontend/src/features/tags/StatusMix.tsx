// Barra del reparto por estado de una etiqueta.
//
// Los colores salen del mapa unico de statusStyles, el mismo del borde de la fila
// en el catalogo y del punto en el filtro: es la tercera representacion del mismo
// dato y no puede desincronizarse.

import { cn } from "@hyperloopupv/frontend-kit/lib";
import type { LogStatus } from "../../api/types";
import { statusStyles, STATUS_ORDER } from "../catalog/statusStyles";

export function StatusMix({
  byStatus,
  total,
  className,
}: {
  byStatus: Partial<Record<LogStatus, number>>;
  total: number;
  className?: string;
}) {
  if (total <= 0) return null;
  const parts = STATUS_ORDER.map((status) => ({
    status,
    count: byStatus[status] ?? 0,
  })).filter((part) => part.count > 0);

  return (
    <span
      className={cn(
        "bg-muted flex h-1 overflow-hidden rounded-full",
        className,
      )}
      // Un lector de pantalla no puede con una barra de colores: la frase lo dice.
      title={parts
        .map((p) => `${p.count} ${statusStyles[p.status].label.toLowerCase()}`)
        .join(" · ")}
    >
      {parts.map((part) => (
        <span
          key={part.status}
          className={statusStyles[part.status].markClass}
          style={{ width: `${(part.count / total) * 100}%` }}
        />
      ))}
    </span>
  );
}
