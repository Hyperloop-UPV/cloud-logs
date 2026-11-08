// Cola de subidas.
//
// Cada entrada guarda su propio UploadHandle para poder cancelarla por separado. Las
// subidas corren a la vez: los bytes van directos a Drive, asi que el backend no es
// el cuello de botella y serializarlas solo haria esperar al usuario.
//
// El progreso se guarda en una ref ademas de en el estado porque llega en rafagas de
// decenas por segundo; el estado se refresca a intervalo fijo para no provocar un
// render por cada evento del XHR.

import { useCallback, useEffect, useRef, useState } from "react";
import { uploadLog } from "../../api/upload";
import type { LogInitiateRequest } from "../../api/types";

export type UploadPhase =
  "queued" | "uploading" | "finishing" | "done" | "failed" | "cancelled";

export interface UploadItem {
  key: string;
  fileName: string;
  fileSize: number;
  phase: UploadPhase;
  progress: number;
  logId: string | null;
  error: string | null;
}

type Metadata = Omit<LogInitiateRequest, "fileName" | "fileSize">;

const PROGRESS_INTERVAL_MS = 120;

export function useUploadQueue() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const handles = useRef(new Map<string, { cancel: (r?: string) => void }>());
  const progress = useRef(new Map<string, number>());

  const patch = useCallback((key: string, changes: Partial<UploadItem>) => {
    setItems((current) =>
      current.map((item) =>
        item.key === key ? { ...item, ...changes } : item,
      ),
    );
  }, []);

  // Vuelca el progreso acumulado al estado a ritmo fijo.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (progress.current.size === 0) return;
      const snapshot = new Map(progress.current);
      progress.current.clear();
      setItems((current) =>
        current.map((item) =>
          snapshot.has(item.key)
            ? { ...item, progress: snapshot.get(item.key) as number }
            : item,
        ),
      );
    }, PROGRESS_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  const enqueue = useCallback(
    (files: File[], metadata: Metadata, onDone?: () => void) => {
      for (const file of files) {
        const key = `${file.name}-${file.size}-${crypto.randomUUID()}`;
        setItems((current) => [
          ...current,
          {
            key,
            fileName: file.name,
            fileSize: file.size,
            phase: "queued",
            progress: 0,
            logId: null,
            error: null,
          },
        ]);

        const handle = uploadLog(file, metadata, {
          onInitiated: (logId) => patch(key, { logId, phase: "uploading" }),
          onProgress: (fraction) => {
            progress.current.set(key, fraction);
            // Al llegar al final del PUT todavia queda que el servidor verifique
            // el fichero en Drive. Sin marcar esa fase, la barra se queda clavada
            // en el 100% y parece colgada.
            if (fraction >= 1) patch(key, { phase: "finishing" });
          },
        });
        handles.current.set(key, handle);

        void handle.done
          .then(() => {
            progress.current.delete(key);
            patch(key, { phase: "done", progress: 1 });
            onDone?.();
          })
          .catch((error: unknown) => {
            progress.current.delete(key);
            const aborted =
              error instanceof DOMException && error.name === "AbortError";
            patch(key, {
              phase: aborted ? "cancelled" : "failed",
              error: aborted
                ? null
                : error instanceof Error
                  ? error.message
                  : "The upload failed.",
            });
          })
          .finally(() => handles.current.delete(key));
      }
    },
    [patch],
  );

  const cancel = useCallback((key: string) => {
    handles.current.get(key)?.cancel("Cancelled by the user");
  }, []);

  const dismiss = useCallback((key: string) => {
    setItems((current) => current.filter((item) => item.key !== key));
  }, []);

  const active = items.some(
    (item) => item.phase === "queued" || item.phase === "uploading",
  );

  // Cerrar la pestaña a mitad deja el log en pending_upload y el fichero a medias
  // en Drive, porque el PUT no pasa por nuestro backend y nadie lo va a abortar.
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);

  return { items, enqueue, cancel, dismiss, active };
}
