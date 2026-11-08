// Tabla del catalogo.
//
// Se monta la <table> a mano, como el resto de la familia, y no con los primitivos
// Table del kit: esos se autoenvuelven en un div con overflow-x-auto no configurable
// y con ese ancestro la cabecera sticky no se pega.
//
// El estado se lee en vertical por la barra de color del borde izquierdo de la fila;
// el badge de texto esta para desambiguar, no para escanear.
//
// La fila entera abre la ficha. Las columnas que quedan son las que se usan para
// *encontrar* un run; todo lo demas (hash, carpeta de Drive, clientMetadata) vive en
// esa ficha, que es lo que permite que la tabla siga siendo legible.

import { Badge, Checkbox } from "@hyperloopupv/frontend-kit/components";
import { FileDown } from "@hyperloopupv/frontend-kit/icons";
import { cn } from "@hyperloopupv/frontend-kit/lib";
import { downloadUrl } from "../../api/endpoints";
import type { Log, SortBy } from "../../api/types";
import {
  Highlight,
  PlainHeader,
  SortableHeader,
} from "../../components/data/ui";
import {
  EMPTY,
  formatBytes,
  formatDateTime,
  formatDuration,
  formatRange,
  formatRelative,
} from "../../lib/format";
import { statusStyle } from "./statusStyles";
import { cellPadding } from "./useTablePrefs";
import type { ColumnId, Density } from "./useTablePrefs";
import type { LogSearchState } from "./useLogSearch";

interface LogTableProps {
  logs: Log[];
  search: LogSearchState;
  /** Texto ya confirmado en la URL, para resaltar coincidencias. */
  highlight: string;
  isVisible: (id: ColumnId) => boolean;
  density: Density;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
}

export function LogTable({
  logs,
  search,
  highlight,
  isVisible,
  density,
  selected,
  onToggleSelect,
  onToggleAll,
}: LogTableProps) {
  const sortProps = {
    sortKey: search.sortBy,
    sortDir: search.sortOrder,
    onSort: (col: SortBy) => search.toggleSort(col),
  };
  const pad = cellPadding(density);
  const allSelected =
    logs.length > 0 && logs.every((log) => selected.has(log.id));
  const someSelected = logs.some((log) => selected.has(log.id));

  return (
    <table className="w-full min-w-[46rem] text-xs">
      <thead className="group/head">
        <tr>
          {/* Columna de la barra de estado: sin cabecera, es un indicador. */}
          <PlainHeader label="" className="w-1 p-0" />
          <PlainHeader label="" className="w-7 pl-2">
            <Checkbox
              checked={
                allSelected ? true : someSelected ? "indeterminate" : false
              }
              onCheckedChange={onToggleAll}
              aria-label="Select all rows on this page"
              className="size-3.5"
            />
          </PlainHeader>
          <SortableHeader label="File" col="fileName" {...sortProps} />
          {isVisible("status") && <PlainHeader label="Status" />}
          {isVisible("window") && (
            <SortableHeader label="Window" col="startDate" {...sortProps} />
          )}
          {isVisible("duration") && (
            <PlainHeader label="Duration" align="right" />
          )}
          {isVisible("size") && (
            <SortableHeader
              label="Size"
              col="fileSize"
              align="right"
              {...sortProps}
            />
          )}
          {isVisible("tags") && <PlainHeader label="Tags" />}
          {isVisible("creator") && <PlainHeader label="Uploaded by" />}
          {isVisible("created") && (
            <SortableHeader label="Registered" col="createdAt" {...sortProps} />
          )}
          <PlainHeader label="" align="right" />
        </tr>
      </thead>
      <tbody>
        {logs.map((log) => {
          const style = statusStyle(log.status);
          const downloadable = log.status === "ready";
          const open = search.selectedId === log.id;
          const picked = selected.has(log.id);

          return (
            <tr
              key={log.id}
              onClick={() => search.selectLog(log.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  search.selectLog(log.id);
                }
              }}
              tabIndex={0}
              aria-selected={open}
              // hover:bg-muted/30 es la convencion de la familia para lo clicable;
              // /20 queda para las filas que no hacen nada.
              className={cn(
                "focus-visible:ring-ring hover:bg-muted/30 cursor-pointer border-b transition-colors outline-none focus-visible:ring-1 focus-visible:ring-inset",
                open && "bg-muted/50",
                picked && !open && "bg-primary/5",
              )}
            >
              <td className="p-0">
                <span
                  className={cn(
                    "block h-full min-h-8 w-[3px]",
                    style.markClass,
                  )}
                  title={style.description}
                />
              </td>

              <td
                className={cn(pad, "pl-2")}
                // La casilla no debe abrir la ficha: son dos acciones distintas.
                onClick={(event) => event.stopPropagation()}
              >
                <Checkbox
                  checked={picked}
                  onCheckedChange={() => onToggleSelect(log.id)}
                  aria-label={`Select ${log.fileName}`}
                  className="size-3.5"
                />
              </td>

              <td className={cn(pad, "max-w-[22rem] font-medium")}>
                <span className="block truncate" title={log.fileName}>
                  <Highlight text={log.fileName} query={highlight} />
                </span>
                {log.note && density === "comfortable" && (
                  <span
                    className="text-muted-foreground block truncate text-[11px]"
                    title={log.note}
                  >
                    <Highlight text={log.note} query={highlight} />
                  </span>
                )}
              </td>

              {isVisible("status") && (
                <td className={pad}>
                  <Badge
                    variant="outline"
                    className={cn(
                      "gap-1 rounded px-1.5 py-0.5 text-[9px] leading-none font-bold uppercase",
                      style.badgeClass,
                    )}
                    title={style.description}
                  >
                    <style.icon className="size-2.5 shrink-0" />
                    {style.label}
                  </Badge>
                </td>
              )}

              {isVisible("window") && (
                <td
                  className={cn(
                    pad,
                    "text-muted-foreground whitespace-nowrap tabular-nums",
                  )}
                >
                  {formatRange(log.startDate, log.endDate)}
                </td>
              )}

              {isVisible("duration") && (
                <td className={cn(pad, "text-right font-mono tabular-nums")}>
                  {formatDuration(log.startDate, log.endDate)}
                </td>
              )}

              {isVisible("size") && (
                <td className={cn(pad, "text-right font-mono tabular-nums")}>
                  {formatBytes(log.fileSize)}
                </td>
              )}

              {isVisible("tags") && (
                <td className={cn(pad, "max-w-[12rem]")}>
                  {log.tags.length === 0 ? (
                    <span className="text-muted-foreground">{EMPTY}</span>
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {log.tags.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          // La fila abre la ficha, asi que el chip tiene que parar
                          // el evento o filtrar abriria tambien el panel.
                          onClick={(event) => {
                            event.stopPropagation();
                            search.toggleTag(tag);
                          }}
                          title={`Filter by ${tag}`}
                          className={cn(
                            "rounded-full border px-1.5 text-[10px] transition-colors",
                            search.tags.includes(tag)
                              ? "border-primary/40 bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {tag}
                        </button>
                      ))}
                    </span>
                  )}
                </td>
              )}

              {isVisible("creator") && (
                <td className={cn(pad, "text-muted-foreground max-w-[9rem]")}>
                  <span className="block truncate" title={log.creator}>
                    {log.creator}
                  </span>
                </td>
              )}

              {isVisible("created") && (
                <td
                  className={cn(pad, "text-muted-foreground whitespace-nowrap")}
                  title={formatDateTime(log.createdAt)}
                >
                  {formatRelative(log.createdAt)}
                </td>
              )}

              <td className={cn(pad, "pr-0 text-right")}>
                {downloadable ? (
                  <a
                    href={downloadUrl(log.id)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    title="Download from Google Drive"
                    className="text-muted-foreground hover:text-primary inline-flex items-center gap-1 transition-colors"
                  >
                    <FileDown className="size-3.5" />
                  </a>
                ) : (
                  <span
                    className="text-muted-foreground/40 inline-flex cursor-not-allowed items-center"
                    title={`Not downloadable while ${style.label.toLowerCase()}`}
                  >
                    <FileDown className="size-3.5" />
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
