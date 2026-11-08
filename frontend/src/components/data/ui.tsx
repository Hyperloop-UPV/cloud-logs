// Piezas de presentacion compartidas por las listas densas.
//
// Adaptadas de adj-view/src/adj/v2/ui.tsx para mantener el mismo lenguaje visual que
// el resto de los frontends del equipo: cuerpo text-xs, cabeceras en mayusculas por
// CSS, lo inactivo marcado con opacidad y no con otro color, y las acciones
// secundarias como enlaces de texto en minuscula.

import { Input } from "@hyperloopupv/frontend-kit/components";
import {
  ChevronDown,
  ChevronUp,
  Search,
} from "@hyperloopupv/frontend-kit/icons";
import type { LucideIcon } from "@hyperloopupv/frontend-kit/icons";
import { cn } from "@hyperloopupv/frontend-kit/lib";
import type { ReactNode, RefObject } from "react";

export type SortDir = "asc" | "desc";

/**
 * Resalta *todas* las coincidencias de la busqueda dentro de un texto. Marcar solo
 * la primera hacia pensar que el resto no casaban.
 */
export function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;

  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (;;) {
    const idx = haystack.indexOf(needle, cursor);
    if (idx === -1) break;
    if (idx > cursor) parts.push(text.slice(cursor, idx));
    parts.push(
      <mark
        key={idx}
        className="bg-primary/25 text-foreground rounded-sm px-0.5"
      >
        {text.slice(idx, idx + query.length)}
      </mark>,
    );
    cursor = idx + query.length;
  }

  if (parts.length === 0) return <>{text}</>;
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

/** Contador de resultados: "n / total", o solo el total si no hay filtro activo. */
export function ResultCount({ n, total }: { n: number; total: number }) {
  return (
    <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">
      {n === total ? total : `${n} / ${total}`}
    </span>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="relative flex-1">
      <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
      <Input
        ref={inputRef}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 px-8 text-xs shadow-none focus-visible:ring-0"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 text-xs"
        >
          ✕
        </button>
      )}
    </div>
  );
}

/**
 * Clases de una celda de cabecera pegajosa.
 *
 * El padding vertical va aqui y no solo abajo: con `top-0`, al hacer scroll la
 * cabecera se queda a ras del contenedor y sin `pt` el texto toca el borde.
 *
 * El borde inferior tambien va en el <th> y no en el <tr>: un borde declarado en la
 * fila no acompana a unas celdas `sticky`, asi que la cabecera se quedaba flotando
 * sobre los datos sin linea que la separase.
 */
const STICKY_HEADER =
  "bg-background sticky top-0 z-10 border-b pt-1 pb-2 align-bottom";

/**
 * Cabecera ordenable. El boton muestra la direccion solo en la columna activa; en
 * las demas la flecha aparece atenuada al pasar por encima de la fila de cabeceras.
 */
export function SortableHeader<K extends string>({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
  align = "left",
  className,
}: {
  label: string;
  col: K;
  sortKey: K;
  sortDir: SortDir;
  onSort: (col: K) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sortKey === col;
  return (
    <th
      className={cn(
        STICKY_HEADER,
        align === "right" ? "pl-3 text-right" : "pr-3 text-left",
        className,
      )}
      aria-sort={
        active ? (sortDir === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        className={cn(
          "inline-flex items-center gap-0.5 text-[10px] font-semibold tracking-wider uppercase transition-colors",
          active
            ? "text-primary"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        {label}
        {active ? (
          sortDir === "asc" ? (
            <ChevronUp className="size-3" />
          ) : (
            <ChevronDown className="size-3" />
          )
        ) : (
          <ChevronDown className="size-3 opacity-0 transition-opacity group-hover/head:opacity-40" />
        )}
      </button>
    </th>
  );
}

/** Cabecera no ordenable, con el mismo tratamiento visual. */
export function PlainHeader({
  label,
  align = "left",
  className,
  children,
}: {
  label: string;
  align?: "left" | "right";
  className?: string;
  /** Contenido en lugar del texto, para una cabecera que lleva un control. */
  children?: ReactNode;
}) {
  return (
    <th
      className={cn(
        STICKY_HEADER,
        "text-muted-foreground text-[10px] font-semibold tracking-wider uppercase",
        align === "right" ? "pl-3 text-right" : "pr-3 text-left",
        className,
      )}
    >
      {children ?? label}
    </th>
  );
}

/**
 * Chip de filtro con contador. Lo inactivo se señala bajando la opacidad, nunca
 * cambiando de color, para que el color solo signifique dato.
 */
export function FilterChip({
  label,
  active,
  count,
  onClick,
  activeClassName,
}: {
  label: string;
  active: boolean;
  count?: number;
  onClick: () => void;
  activeClassName?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-all",
        active
          ? (activeClassName ?? "border-primary/40 bg-primary/10 text-primary")
          : "border-border text-muted-foreground opacity-50 hover:opacity-80",
      )}
    >
      {label}
      {count !== undefined && (
        <span className="tabular-nums opacity-70">{count}</span>
      )}
    </button>
  );
}

/**
 * Estado vacio. El icono lo elige quien llama: una lupa solo tiene sentido cuando
 * se ha buscado algo; si el catalogo esta vacio de verdad, nadie ha buscado nada.
 */
export function EmptyState({
  text,
  action,
  icon: Icon = Search,
}: {
  text: string;
  action?: { label: string; onClick: () => void };
  icon?: LucideIcon;
}) {
  return (
    <div className="text-muted-foreground flex flex-col items-center justify-center py-12 text-sm">
      <Icon className="mb-2 size-8 opacity-20" />
      {text}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="hover:text-foreground mt-2 text-xs underline underline-offset-2"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
