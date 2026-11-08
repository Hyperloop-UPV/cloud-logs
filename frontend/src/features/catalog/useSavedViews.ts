// Busquedas guardadas con nombre.
//
// Una vista es literalmente la query string del catalogo. Toda la busqueda (texto,
// tags, estado, fechas, orden y pagina) ya vive en la URL, asi que guardarla es
// guardar esa cadena: no hace falta inventar un formato ni tocar el backend, y
// aplicar una vista es navegar a esa URL.
//
// Viven en localStorage, no en el servidor, porque el API no tiene donde guardarlas
// y esta tanda no toca el backend. La consecuencia hay que decirla en la interfaz:
// son de este navegador, no de la cuenta.

import { useCallback, useEffect, useState } from "react";

export interface SavedView {
  id: string;
  name: string;
  /** Query string sin el "?", tal cual la produce useSearchParams. */
  query: string;
}

const STORAGE_KEY = "cloud-logs-saved-views";
const MAX_VIEWS = 20;

function parse(raw: string | null): SavedView[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is SavedView =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as SavedView).id === "string" &&
          typeof (item as SavedView).name === "string" &&
          typeof (item as SavedView).query === "string",
      )
      .slice(0, MAX_VIEWS);
  } catch {
    return [];
  }
}

export function useSavedViews() {
  const [views, setViews] = useState<SavedView[]>(() => {
    try {
      return parse(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
    } catch {
      // Sin almacenamiento las vistas duran lo que la pestana.
    }
  }, [views]);

  const save = useCallback((name: string, query: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setViews((current) => {
      // Guardar con un nombre que ya existe lo sobrescribe, que es lo que espera
      // alguien que acaba de ajustar una vista suya y la vuelve a guardar igual.
      const existing = current.find(
        (view) => view.name.toLowerCase() === trimmed.toLowerCase(),
      );
      if (existing) {
        return current.map((view) =>
          view.id === existing.id ? { ...view, query } : view,
        );
      }
      return [
        ...current,
        { id: crypto.randomUUID(), name: trimmed, query },
      ].slice(-MAX_VIEWS);
    });
  }, []);

  const rename = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setViews((current) =>
      current.map((view) =>
        view.id === id ? { ...view, name: trimmed } : view,
      ),
    );
  }, []);

  const remove = useCallback((id: string) => {
    setViews((current) => current.filter((view) => view.id !== id));
  }, []);

  return { views, save, rename, remove };
}
