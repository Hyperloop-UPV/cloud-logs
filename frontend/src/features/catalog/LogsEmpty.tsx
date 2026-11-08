// Dos vacios distintos, porque la salida del usuario es distinta: si hay filtros, lo
// que falta es quitarlos; si el catalogo esta vacio de verdad, lo que falta es subir
// el primer archivo.

import type { LucideIcon } from "@hyperloopupv/frontend-kit/icons";
import { EmptyState } from "../../components/data/ui";

interface LogsEmptyProps {
  hasFilters: boolean;
  onClearFilters: () => void;
  /** Icono para el catalogo vacio de verdad; con filtros se usa siempre la lupa. */
  icon?: LucideIcon;
}

export function LogsEmpty({
  hasFilters,
  onClearFilters,
  icon,
}: LogsEmptyProps) {
  if (hasFilters) {
    return (
      <EmptyState
        text="No logs match the current filters."
        action={{ label: "clear filters", onClick: onClearFilters }}
      />
    );
  }
  return (
    <EmptyState
      icon={icon}
      text="No logs in the catalog yet. The first upload will show up here."
    />
  );
}
