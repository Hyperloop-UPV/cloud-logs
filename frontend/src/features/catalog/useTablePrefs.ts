// Preferencias de presentacion de la tabla: que columnas se ven y como de apretada
// va la cuadricula.
//
// No viven en la URL, a diferencia de los filtros. La busqueda se comparte por
// enlace porque describe *que* datos se miran; esto describe como los quiere ver una
// persona concreta en su pantalla, y mandarselo a un companero junto con la busqueda
// seria imponerle tu configuracion. Por eso van a localStorage.

import { useCallback, useEffect, useState } from "react";

export const COLUMNS = [
  { id: "status", label: "Status" },
  { id: "window", label: "Window" },
  { id: "duration", label: "Duration" },
  { id: "size", label: "Size" },
  { id: "tags", label: "Tags" },
  { id: "creator", label: "Uploaded by" },
  { id: "created", label: "Registered" },
] as const;

export type ColumnId = (typeof COLUMNS)[number]["id"];

/** El nombre del fichero y la descarga no se pueden ocultar: sin ellos no hay tabla. */
export type Density = "comfortable" | "compact";

export interface TablePrefs {
  hidden: ColumnId[];
  density: Density;
}

const STORAGE_KEY = "cloud-logs-table-prefs";

const DEFAULTS: TablePrefs = { hidden: [], density: "comfortable" };

const COLUMN_IDS = new Set<string>(COLUMNS.map((column) => column.id));

/**
 * Lo guardado puede venir de una version anterior de la app, haberlo editado alguien
 * a mano, o no existir. Se sanea campo a campo en vez de confiar en el JSON.
 */
function parse(raw: string | null): TablePrefs {
  if (!raw) return DEFAULTS;
  try {
    const parsed = JSON.parse(raw) as Partial<TablePrefs>;
    return {
      hidden: Array.isArray(parsed.hidden)
        ? parsed.hidden.filter((id): id is ColumnId => COLUMN_IDS.has(id))
        : [],
      density: parsed.density === "compact" ? "compact" : "comfortable",
    };
  } catch {
    return DEFAULTS;
  }
}

export function useTablePrefs() {
  const [prefs, setPrefs] = useState<TablePrefs>(() => {
    // En una pestana privada, o con el almacenamiento bloqueado, leer lanza.
    try {
      return parse(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      return DEFAULTS;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // Sin almacenamiento la preferencia dura lo que la pestana. No es motivo
      // para romper la pagina.
    }
  }, [prefs]);

  const toggleColumn = useCallback((id: ColumnId) => {
    setPrefs((current) => ({
      ...current,
      hidden: current.hidden.includes(id)
        ? current.hidden.filter((hidden) => hidden !== id)
        : [...current.hidden, id],
    }));
  }, []);

  const setDensity = useCallback((density: Density) => {
    setPrefs((current) => ({ ...current, density }));
  }, []);

  const resetColumns = useCallback(() => {
    setPrefs((current) => ({ ...current, hidden: [] }));
  }, []);

  const isVisible = useCallback(
    (id: ColumnId) => !prefs.hidden.includes(id),
    [prefs.hidden],
  );

  return { prefs, isVisible, toggleColumn, setDensity, resetColumns };
}

/** Clases de celda segun la densidad, para que cabecera y cuerpo no se separen. */
export function cellPadding(density: Density): string {
  return density === "compact" ? "py-1 pr-3" : "py-2 pr-3";
}
