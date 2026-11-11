// Las estadísticas por etiqueta se calculan en el servidor vía GET /logs/tags/stats,
// evitando realizar múltiples peticiones secuenciales y garantizando totales exactos.
// Los registros individuales se obtienen en paralelo para renderizar los nodos del grafo.

import { useQuery } from "@tanstack/react-query";
import { getTagsStats, searchLogs } from "../../api/endpoints";
import type { Log, LogStatus } from "../../api/types";

/** Tope del API (`pageSize` tiene `le=100`). */
const PAGE_SIZE = 100;
/** Hasta 2.000 logs para el grafo interactivo. */
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
      const [statsRes, firstPage] = await Promise.all([
        getTagsStats(),
        searchLogs({
          page: 1,
          pageSize: PAGE_SIZE,
          sortBy: "createdAt",
          sortOrder: "desc",
        }),
      ]);

      const collected: Log[] = [...firstPage.items];
      const total = firstPage.total;
      let truncated = false;

      // Si el catálogo tiene más de una página de logs para el lienzo del grafo, completamos hasta MAX_PAGES
      if (collected.length < total) {
        for (let page = 2; page <= MAX_PAGES; page++) {
          const result = await searchLogs({
            page,
            pageSize: PAGE_SIZE,
            sortBy: "createdAt",
            sortOrder: "desc",
          });
          collected.push(...result.items);
          if (collected.length >= total || result.items.length === 0) break;
          if (page === MAX_PAGES) truncated = collected.length < total;
        }
      }

      // Convertimos las estadísticas calculadas en el servidor
      const tags: TagAggregate[] = statsRes.tags.map((t) => ({
        tag: t.tag,
        logs: t.logs,
        bytes: t.totalSize,
        byStatus: t.statusMix as Partial<Record<LogStatus, number>>,
        firstSeen: t.firstUsed,
        lastSeen: t.lastUsed,
        coOccurring: new Map(t.usedWith.map((u) => [u.tag, u.count])),
      }));

      const untagged = collected.filter((log) => log.tags.length === 0).length;

      return {
        tags,
        logs: collected,
        scanned: collected.length,
        total,
        truncated,
        untagged,
      };
    },
    staleTime: 60_000,
  });
}
