/**
 * Subida en dos fases: initiate -> PUT directo a Google Drive -> complete.
 * Los bytes nunca pasan por el backend.
 *
 * El PUT va con XHR y no con fetch porque solo XHR reporta progreso de subida.
 */

import { abortUpload, completeUpload, initiateUpload } from "./endpoints";
import type { LogCompleteResponse, LogInitiateRequest } from "./types";

export interface UploadHandle {
  /** Promesa del log ya verificado y en estado ready. */
  done: Promise<LogCompleteResponse>;
  /** Corta la transferencia y marca el log como aborted en el catálogo. */
  cancel: (reason?: string) => void;
}

export interface UploadCallbacks {
  /** 0–1. Solo cubre la transferencia a Drive, no las fases de metadatos. */
  onProgress?: (fraction: number, loadedBytes: number) => void;
  onInitiated?: (logId: string) => void;
}

function putToDrive(
  uploadUrl: string,
  file: File,
  callbacks: UploadCallbacks,
  registerXhr: (xhr: XMLHttpRequest) => void,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    registerXhr(xhr);
    xhr.open("PUT", uploadUrl, true);
    xhr.setRequestHeader("Content-Type", file.type || "application/zip");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        callbacks.onProgress?.(event.loaded / event.total, event.loaded);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        // Drive responde con el recurso creado; de ahí sacamos el fileId real.
        try {
          const parsed = JSON.parse(xhr.responseText) as { id?: string };
          resolve(parsed.id ?? null);
        } catch {
          resolve(null);
        }
        return;
      }
      reject(new Error(`Google Drive rechazó la subida (HTTP ${xhr.status})`));
    };
    xhr.onerror = () =>
      reject(
        new Error("No se pudo conectar con Google Drive para subir el archivo"),
      );
    xhr.onabort = () =>
      reject(new DOMException("Subida cancelada", "AbortError"));

    xhr.send(file);
  });
}

/**
 * Lanza la subida completa. No esperes a `done` para devolver el control a la UI:
 * usa `onProgress` y guarda `cancel` para el botón de cancelar.
 */
export function uploadLog(
  file: File,
  metadata: Omit<LogInitiateRequest, "fileName" | "fileSize">,
  callbacks: UploadCallbacks = {},
): UploadHandle {
  let xhr: XMLHttpRequest | null = null;
  let logId: string | null = null;
  let cancelled = false;
  let cancelReason: string | undefined;

  const done = (async () => {
    const session = await initiateUpload({
      ...metadata,
      fileName: file.name,
      fileSize: file.size,
    });
    logId = session.id;
    callbacks.onInitiated?.(session.id);

    if (cancelled) {
      await abortUpload(session.id, cancelReason);
      throw new DOMException("Subida cancelada", "AbortError");
    }

    let completed = false;
    try {
      const driveFileId = await putToDrive(
        session.uploadUrl,
        file,
        callbacks,
        (x) => {
          xhr = x;
        },
      );
      completed = true;
      return await completeUpload(session.id, {
        driveFileId,
        fileHash: metadata.fileHash ?? null,
      });
    } catch (error) {
      // Si el fallo ocurrió durante completeUpload, el backend ya marcó el log como "failed".
      // Solo abortamos si la transferencia por red no llegó a completarse.
      if (!completed) {
        await abortUpload(
          session.id,
          cancelReason ?? "Fallo en la transferencia",
        ).catch(() => {});
      }
      throw error;
    }
  })();

  return {
    done,
    cancel: (reason?: string) => {
      cancelled = true;
      cancelReason = reason;
      xhr?.abort();
      if (!xhr && logId) void abortUpload(logId, reason).catch(() => {});
    },
  };
}

/**
 * SHA-256 del archivo para `fileHash`. Opcional: carga el archivo entero en memoria,
 * así que no lo uses con archivos de cientos de MB sin medirlo antes.
 */
export async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
