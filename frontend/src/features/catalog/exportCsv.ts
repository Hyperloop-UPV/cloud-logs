// Exportar a CSV lo que hay en la tabla.
//
// Se genera en el navegador con los datos que ya estan cargados: el API no tiene
// endpoint de exportacion y esta tanda no toca el backend. Por eso exporta la pagina
// visible (o la seleccion), no el catalogo entero, y la interfaz lo dice.

import type { Log } from "../../api/types";

const COLUMNS: { header: string; value: (log: Log) => string }[] = [
  { header: "id", value: (log) => log.id },
  { header: "fileName", value: (log) => log.fileName },
  { header: "status", value: (log) => log.status },
  { header: "fileSize", value: (log) => String(log.fileSize ?? "") },
  { header: "tags", value: (log) => log.tags.join(" ") },
  { header: "note", value: (log) => log.note ?? "" },
  { header: "creator", value: (log) => log.creator },
  { header: "startDate", value: (log) => log.startDate ?? "" },
  { header: "endDate", value: (log) => log.endDate ?? "" },
  { header: "createdAt", value: (log) => log.createdAt },
  { header: "completedAt", value: (log) => log.completedAt ?? "" },
  { header: "driveFolder", value: (log) => log.driveFolder ?? "" },
  { header: "driveUrl", value: (log) => log.driveUrl ?? "" },
  { header: "fileHash", value: (log) => log.fileHash ?? "" },
];

/**
 * Entrecomilla un campo segun RFC 4180.
 *
 * Ademas antepone un apostrofo a lo que empiece por =, +, - o @: Excel y Sheets
 * interpretan esas celdas como formulas, y un nombre de fichero que empiece por
 * guion acabaria ejecutandose en vez de leerse.
 */
function escape(value: string): string {
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function toCsv(logs: Log[]): string {
  const header = COLUMNS.map((column) => escape(column.header)).join(",");
  const rows = logs.map((log) =>
    COLUMNS.map((column) => escape(column.value(log))).join(","),
  );
  // CRLF y BOM: es lo que hace que Excel abra el fichero con los acentos bien.
  return `﻿${[header, ...rows].join("\r\n")}\r\n`;
}

export function downloadCsv(logs: Log[], filename: string): void {
  const blob = new Blob([toCsv(logs)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Sin revocar, el blob se queda en memoria hasta recargar la pagina.
  URL.revokeObjectURL(url);
}

/** Nombre con fecha, para que varias exportaciones no se pisen en Descargas. */
export function csvFilename(prefix = "cloud-logs"): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${prefix}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.csv`;
}
