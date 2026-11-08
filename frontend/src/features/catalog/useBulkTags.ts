// Etiquetado en lote.
//
// El API edita de uno en uno (PATCH /logs/{id}), asi que esto son N peticiones. Tres
// cosas que hay que hacer bien y no son obvias:
//
// 1. **Concurrencia limitada.** Cien PATCH a la vez saturan el navegador y el
//    servidor, que corre con un unico worker de uvicorn sobre SQLite.
// 2. **Los fallos se cuentan, no se tragan.** Un usuario normal solo puede editar
//    sus propios logs, asi que en una seleccion mixta habra 403. El resultado dice
//    "27 updated, 4 skipped", no falla entero ni finge que fue bien.
// 3. **Se parte de los tags de cada log, no de una lista comun.** Anadir "bms" a
//    diez logs no puede dejarlos a todos con los mismos tags: se suma al conjunto
//    que ya tenia cada uno.

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { ApiError } from "../../api/client";
import { updateLog } from "../../api/endpoints";
import type { Log } from "../../api/types";

const CONCURRENCY = 4;

export interface BulkResult {
  updated: number;
  unchanged: number;
  forbidden: number;
  failed: number;
}

/** Recorre las tareas con como mucho `limit` en vuelo a la vez. */
async function mapLimit<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        await worker(items[index]);
      }
    },
  );
  await Promise.all(runners);
}

export function useBulkTags() {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);

  const apply = useCallback(
    async (logs: Log[], mode: "add" | "remove", tags: string[]) => {
      if (logs.length === 0 || tags.length === 0) return;
      setRunning(true);
      setResult(null);

      const tally: BulkResult = {
        updated: 0,
        unchanged: 0,
        forbidden: 0,
        failed: 0,
      };

      await mapLimit(logs, CONCURRENCY, async (log) => {
        const current = new Set(log.tags);
        for (const tag of tags) {
          if (mode === "add") current.add(tag);
          else current.delete(tag);
        }
        const next = [...current];

        // Nada que cambiar: no se gasta una peticion.
        if (
          next.length === log.tags.length &&
          next.every((tag) => log.tags.includes(tag))
        ) {
          tally.unchanged += 1;
          return;
        }

        try {
          await updateLog(log.id, { tags: next });
          tally.updated += 1;
        } catch (error) {
          if (error instanceof ApiError && error.status === 403) {
            tally.forbidden += 1;
          } else {
            tally.failed += 1;
          }
        }
      });

      if (tally.updated > 0) {
        void queryClient.invalidateQueries({ queryKey: ["logs"] });
        void queryClient.invalidateQueries({ queryKey: ["logTags"] });
        void queryClient.invalidateQueries({ queryKey: ["logStats"] });
      }

      setResult(tally);
      setRunning(false);
      return tally;
    },
    [queryClient],
  );

  return { apply, running, result, clearResult: () => setResult(null) };
}

/** Frase corta del resultado, para enseñarla al lado del boton. */
export function describeResult(result: BulkResult): string {
  const parts: string[] = [];
  if (result.updated) parts.push(`${result.updated} updated`);
  if (result.unchanged) parts.push(`${result.unchanged} already set`);
  if (result.forbidden) parts.push(`${result.forbidden} skipped (not yours)`);
  if (result.failed) parts.push(`${result.failed} failed`);
  return parts.join(" · ") || "Nothing to change";
}
