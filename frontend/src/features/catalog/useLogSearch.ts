// Estado de la busqueda del catalogo, sincronizado con la query string.
//
// La URL es la fuente de verdad: asi una busqueda y su pagina se comparten por
// enlace y sobreviven a una recarga, que es lo que justifica paginar de forma
// explicita en vez de con scroll continuo.
//
// El texto de busqueda se escribe con debounce: se teclea sobre un estado local y
// solo se empuja a la URL (y al API) cuando para, para no lanzar una peticion ni
// una entrada de historial por pulsacion.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { searchLogs } from "../../api/endpoints";
import type { LogQuery, LogStatus, SortBy, SortOrder } from "../../api/types";

const DEBOUNCE_MS = 300;

/** Topado a 100 porque es el maximo que admite el API. */
export const PAGE_SIZES = [25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 50;

const SORT_KEYS: SortBy[] = [
  "createdAt",
  "fileDate",
  "startDate",
  "endDate",
  "fileName",
  "fileSize",
];

/** El API devuelve 400 ante un sortBy que no conoce, asi que se sanea aqui. */
function parseSort(value: string | null): SortBy {
  return SORT_KEYS.includes(value as SortBy) ? (value as SortBy) : "createdAt";
}

function parseDir(value: string | null): SortOrder {
  return value === "asc" ? "asc" : "desc";
}

function parseSize(value: string | null): number {
  const parsed = Number(value);
  return PAGE_SIZES.includes(parsed as (typeof PAGE_SIZES)[number])
    ? parsed
    : DEFAULT_PAGE_SIZE;
}

function parsePage(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

/** Fecha de un <input type="date"> a instante ISO, acotando el dia completo. */
function toIso(day: string, edge: "start" | "end"): string | undefined {
  if (!day) return undefined;
  const suffix = edge === "start" ? "T00:00:00.000Z" : "T23:59:59.999Z";
  const date = new Date(`${day}${suffix}`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export interface LogSearchState {
  /** Valor inmediato del cuadro de busqueda, antes del debounce. */
  textInput: string;
  setTextInput: (value: string) => void;
  /** Texto ya confirmado en la URL y enviado al API: es el que se resalta. */
  committedText: string;
  tags: string[];
  toggleTag: (tag: string) => void;
  /** Reemplaza la lista entera, para el selector multiple. */
  setTags: (tags: string[]) => void;
  status: LogStatus | null;
  /** Fija el estado, o null para quitarlo. El API solo admite uno a la vez. */
  setStatus: (status: LogStatus | null) => void;
  creator: string;
  setCreator: (value: string) => void;
  from: string;
  to: string;
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
  metadataQuery: string;
  setMetadataQuery: (value: string) => void;
  /** Carpeta mensual de Drive, "YYYY_MM". El API filtra por ella con driveFolder. */
  driveFolder: string;
  setDriveFolder: (value: string) => void;
  sortBy: SortBy;
  sortOrder: SortOrder;
  toggleSort: (key: SortBy) => void;
  page: number;
  setPage: (page: number) => void;
  pageSize: number;
  setPageSize: (size: number) => void;
  /** Log abierto en el panel de detalle, o null. Vive en ?log=<uuid>. */
  selectedId: string | null;
  selectLog: (id: string | null) => void;
  /** Mueve la seleccion a la fila anterior (-1) o siguiente (+1) de esta pagina. */
  moveSelection: (direction: -1 | 1) => void;
  /** Hay al menos un filtro activo (el orden y la pagina no cuentan). */
  hasFilters: boolean;
  clearFilters: () => void;
  query: ReturnType<typeof useLogsQuery>;
}

function useLogsQuery(params: LogQuery) {
  return useQuery({
    queryKey: ["logs", params],
    queryFn: () => searchLogs(params),
    // Mantener la pagina anterior mientras llega la nueva evita que la tabla
    // parpadee y que el alto del contenedor salte al cambiar de pagina.
    placeholderData: keepPreviousData,
  });
}

export function useLogSearch(): LogSearchState {
  const [params, setParams] = useSearchParams();

  const urlText = params.get("q") ?? "";
  const tags = useMemo(() => {
    const raw = params.get("tags");
    return raw ? raw.split(",").filter(Boolean) : [];
  }, [params]);
  const status = (params.get("status") as LogStatus | null) ?? null;
  const creator = params.get("creator") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const metadataQuery = params.get("meta") ?? "";
  const driveFolder = params.get("folder") ?? "";
  const selectedId = params.get("log");
  const sortBy = parseSort(params.get("sort"));
  const sortOrder = parseDir(params.get("dir"));
  const page = parsePage(params.get("page"));
  const pageSize = parseSize(params.get("size"));

  const [textInput, setTextInput] = useState(urlText);
  const [lastUrlText, setLastUrlText] = useState(urlText);
  const pending = useRef<number | undefined>(undefined);

  /**
   * Escribe en la query string. `resetPage` vuelve a la primera pagina en todo
   * cambio de filtro: quedarse en la pagina 7 de un resultado que ahora tiene 2 es
   * la forma mas facil de ver una tabla vacia sin entender por que.
   */
  const update = useCallback(
    (changes: Record<string, string | null>, resetPage = true) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(changes)) {
            if (value === null || value === "") next.delete(key);
            else next.set(key, value);
          }
          if (resetPage) next.delete("page");
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // El texto local se empuja a la URL cuando el usuario deja de teclear.
  useEffect(() => {
    if (textInput === urlText) return;
    pending.current = window.setTimeout(() => {
      update({ q: textInput || null });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(pending.current);
  }, [textInput, urlText, update]);

  // Si la URL cambia por fuera (atras/adelante, enlace pegado), el cuadro la sigue.
  // Se ajusta en render y no en un efecto: un setState dentro de useEffect provocaria
  // un segundo render en cascada en cada navegacion. Es el patron que React documenta
  // para derivar estado de un valor anterior.
  if (urlText !== lastUrlText) {
    setLastUrlText(urlText);
    setTextInput(urlText);
  }

  const effective: LogQuery = useMemo(
    () => ({
      page,
      pageSize,
      textQuery: urlText || undefined,
      tags: tags.length ? tags : undefined,
      status: status ?? undefined,
      creator: creator || undefined,
      startDate: toIso(from, "start"),
      endDate: toIso(to, "end"),
      metadataQuery: metadataQuery || undefined,
      driveFolder: driveFolder || undefined,
      sortBy,
      sortOrder,
    }),
    [
      page,
      pageSize,
      urlText,
      tags,
      status,
      creator,
      from,
      to,
      metadataQuery,
      driveFolder,
      sortBy,
      sortOrder,
    ],
  );

  const query = useLogsQuery(effective);

  const hasFilters =
    Boolean(urlText) ||
    tags.length > 0 ||
    Boolean(status) ||
    Boolean(creator) ||
    Boolean(from) ||
    Boolean(to) ||
    Boolean(metadataQuery) ||
    Boolean(driveFolder);

  return {
    textInput,
    setTextInput,
    committedText: urlText,
    tags,
    toggleTag: (tag) =>
      update({
        tags:
          (tags.includes(tag)
            ? tags.filter((t) => t !== tag)
            : [...tags, tag]
          ).join(",") || null,
      }),
    setTags: (next) => update({ tags: next.join(",") || null }),
    status,
    setStatus: (next) => update({ status: next }),
    creator,
    setCreator: (value) => update({ creator: value || null }),
    from,
    to,
    setFrom: (value) => update({ from: value || null }),
    setTo: (value) => update({ to: value || null }),
    metadataQuery,
    setMetadataQuery: (value) => update({ meta: value || null }),
    driveFolder,
    setDriveFolder: (value) => update({ folder: value || null }),
    sortBy,
    sortOrder,
    // Pulsar la columna activa invierte la direccion; otra columna empieza en desc,
    // que es lo util en un catalogo cronologico.
    toggleSort: (key) =>
      update(
        key === sortBy
          ? { dir: sortOrder === "asc" ? "desc" : "asc" }
          : { sort: key, dir: "desc" },
      ),
    page,
    setPage: (next) => update({ page: next > 1 ? String(next) : null }, false),
    pageSize,
    setPageSize: (size) =>
      update({ size: size === DEFAULT_PAGE_SIZE ? null : String(size) }),
    selectedId,
    // La seleccion no reinicia la pagina: se abre un log de la pagina en la que se
    // esta, y al cerrarlo hay que seguir ahi.
    selectLog: (id) => update({ log: id }, false),
    moveSelection: (direction) => {
      const items = query.data?.items ?? [];
      if (items.length === 0) return;
      const current = items.findIndex((item) => item.id === selectedId);
      // Sin seleccion previa, bajar entra por la primera fila y subir por la ultima.
      const next =
        current === -1
          ? direction === 1
            ? 0
            : items.length - 1
          : current + direction;
      if (next < 0 || next >= items.length) return;
      update({ log: items[next].id }, false);
    },
    hasFilters,
    clearFilters: () => {
      setTextInput("");
      update({
        q: null,
        tags: null,
        status: null,
        creator: null,
        from: null,
        to: null,
        meta: null,
        folder: null,
      });
    },
    query,
  };
}
