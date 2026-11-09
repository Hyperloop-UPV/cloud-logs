// Agregacion por etiqueta, hecha en el cliente.
//
// El API no da agregados por etiqueta: `/logs/tags` devuelve solo los nombres y
// `stats.topTags` son los diez primeros con el numero de logs y nada mas —ni bytes,
// ni fechas, ni con que otras etiquetas coinciden—. Como esta tanda no toca el
// backend, lo unico que queda es paginar `/logs` y sumar aqui.
//
// Eso tiene un coste que la pantalla dice en voz alta: con 63 logs es una peticion,
// pero con 5.000 serian cincuenta. Por eso se corta en MAX_PAGES y el resultado
// lleva `truncated`, para no enseñar cifras parciales como si fueran el total.
//
// Lo correcto a medio plazo es un endpoint que agregue en SQL.

import { useQuery } from "@tanstack/react-query";
import { searchLogs } from "../../api/endpoints";
import type { Log, LogStatus } from "../../api/types";

/** Tope del API (`pageSize` tiene `le=100`). */
const PAGE_SIZE = 100;
/** Hasta 2.000 logs: veinte peticiones en el peor caso. */
const MAX_PAGES = 20;

export interface TagAggregate {
  tag: string;
  logs: number;
  bytes: number;
  byStatus: Partial<Record<LogStatus, number>>;
  /** ISO del log mas antiguo y del mas reciente con esta etiqueta. */
  firstSeen: string | null;
  lastSeen: string | null;
  /** Con que otras etiquetas comparte logs, y en cuantos. */
  coOccurring: Map<string, number>;
}

export interface TagAggregateResult {
  tags: TagAggregate[];
  /** Los logs examinados. El grafo pinta uno por nodo, asi que los necesita. */
  logs: Log[];
  /** Logs examinados. */
  scanned: number;
  /** Total que dice el API, para poder comparar. */
  total: number;
  /** true si se alcanzo el tope y las cifras son parciales. */
  truncated: boolean;
  /** Logs sin ninguna etiqueta: lo que esta pantalla no ve. */
  untagged: number;
}

function aggregate(
  logs: Log[],
  total: number,
  truncated: boolean,
): TagAggregateResult {
  const map = new Map<string, TagAggregate>();
  let untagged = 0;

  for (const log of logs) {
    // Duplicados defensivos: un log con el mismo tag dos veces contaria doble.
    const tags = [...new Set(log.tags)];
    if (tags.length === 0) {
      untagged += 1;
      continue;
    }

    for (const tag of tags) {
      let entry = map.get(tag);
      if (!entry) {
        entry = {
          tag,
          logs: 0,
          bytes: 0,
          byStatus: {},
          firstSeen: null,
          lastSeen: null,
          coOccurring: new Map(),
        };
        map.set(tag, entry);
      }

      entry.logs += 1;
      entry.bytes += log.fileSize ?? 0;
      entry.byStatus[log.status] = (entry.byStatus[log.status] ?? 0) + 1;

      // Se usa createdAt, que siempre existe; startDate puede ser null.
      if (!entry.firstSeen || log.createdAt < entry.firstSeen)
        entry.firstSeen = log.createdAt;
      if (!entry.lastSeen || log.createdAt > entry.lastSeen)
        entry.lastSeen = log.createdAt;

      for (const other of tags) {
        if (other === tag) continue;
        entry.coOccurring.set(other, (entry.coOccurring.get(other) ?? 0) + 1);
      }
    }
  }

  const tags = [...map.values()].sort(
    (a, b) => b.logs - a.logs || a.tag.localeCompare(b.tag),
  );
  return { tags, logs, scanned: logs.length, total, truncated, untagged };
}

/** Aristas del grafo: un par por cada dos etiquetas que comparten algun log. */
export function coOccurrenceEdges(
  tags: TagAggregate[],
): { source: string; target: string; weight: number }[] {
  const seen = new Set<string>();
  const edges: { source: string; target: string; weight: number }[] = [];
  for (const entry of tags) {
    for (const [other, weight] of entry.coOccurring) {
      // El mapa es simetrico, asi que cada par aparece dos veces.
      const key =
        entry.tag < other
          ? `${entry.tag}\u0000${other}`
          : `${other}\u0000${entry.tag}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: entry.tag, target: other, weight });
    }
  }
  return edges;
}

export function useTagAggregate() {
  return useQuery({
    queryKey: ["tagAggregate"],
    queryFn: async (): Promise<TagAggregateResult> => {
      const collected: Log[] = [];
      let total = 0;
      let page = 1;
      let truncated = false;

      for (; page <= MAX_PAGES; page++) {
        // Orden fijo y explicito: paginar sobre un orden inestable podria repetir
        // u omitir filas entre peticiones.
        const result = await searchLogs({
          page,
          pageSize: PAGE_SIZE,
          sortBy: "createdAt",
          sortOrder: "desc",
        });
        total = result.total;
        collected.push(...result.items);
        if (collected.length >= total || result.items.length === 0) break;
        if (page === MAX_PAGES) truncated = collected.length < total;
      }

      return aggregate(collected, total, truncated);
    },
    staleTime: 60_000,
  });
}
