// Etiquetas en tabla densa y ordenable.
//
// Misma maquetacion que el catalogo: <table> a mano (los primitivos del kit se
// autoenvuelven en un overflow que rompe la cabecera pegajosa) y las primitivas
// compartidas de components/data/ui.tsx.

import { cn } from "@hyperloopupv/frontend-kit/lib";
import { useState } from "react";
import { PlainHeader, SortableHeader } from "../../components/data/ui";
import {
  EMPTY,
  formatBytes,
  formatDate,
  formatRelative,
} from "../../lib/format";
import { StatusMix } from "./StatusMix";
import type { TagAggregate } from "./useTagAggregate";

type Column = "tag" | "logs" | "bytes" | "avg" | "first" | "last";

export function TagTable({
  tags,
  onPick,
}: {
  tags: TagAggregate[];
  onPick: (tag: string) => void;
}) {
  const [sortKey, setSortKey] = useState<Column>("logs");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const toggle = (col: Column) => {
    if (col === sortKey) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(col);
      // El nombre se lee mejor de la A a la Z; los numeros, de mayor a menor.
      setSortDir(col === "tag" ? "asc" : "desc");
    }
  };

  const value = (entry: TagAggregate, col: Column): number | string => {
    switch (col) {
      case "tag":
        return entry.tag;
      case "logs":
        return entry.logs;
      case "bytes":
        return entry.bytes;
      case "avg":
        return entry.logs ? entry.bytes / entry.logs : 0;
      case "first":
        return entry.firstSeen ?? "";
      case "last":
        return entry.lastSeen ?? "";
    }
  };

  const sorted = [...tags].sort((a, b) => {
    const x = value(a, sortKey);
    const y = value(b, sortKey);
    const cmp =
      typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y));
    return sortDir === "asc" ? cmp : -cmp;
  });

  const sortProps = { sortKey, sortDir, onSort: toggle };

  return (
    <table className="w-full min-w-[46rem] text-xs">
      <thead>
        <tr>
          <SortableHeader label="Tag" col={"tag" as Column} {...sortProps} />
          <SortableHeader
            label="Logs"
            col={"logs" as Column}
            align="right"
            {...sortProps}
          />
          <SortableHeader
            label="Total size"
            col={"bytes" as Column}
            align="right"
            {...sortProps}
          />
          <SortableHeader
            label="Average"
            col={"avg" as Column}
            align="right"
            {...sortProps}
          />
          <PlainHeader label="Status mix" />
          <SortableHeader
            label="First used"
            col={"first" as Column}
            {...sortProps}
          />
          <SortableHeader
            label="Last used"
            col={"last" as Column}
            {...sortProps}
          />
          <PlainHeader label="Used with" />
        </tr>
      </thead>
      <tbody>
        {sorted.map((entry) => {
          const together = [...entry.coOccurring.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);
          return (
            <tr
              key={entry.tag}
              onClick={() => onPick(entry.tag)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onPick(entry.tag);
                }
              }}
              tabIndex={0}
              title={`Show the ${entry.logs} logs tagged ${entry.tag}`}
              className="hover:bg-muted/30 focus-visible:ring-ring cursor-pointer border-b transition-colors outline-none focus-visible:ring-1 focus-visible:ring-inset"
            >
              <td className="py-2 pr-3 font-medium">{entry.tag}</td>
              <td className="py-2 pr-3 text-right font-mono tabular-nums">
                {entry.logs}
              </td>
              <td className="py-2 pr-3 text-right font-mono tabular-nums">
                {formatBytes(entry.bytes)}
              </td>
              <td className="text-muted-foreground py-2 pr-3 text-right font-mono tabular-nums">
                {formatBytes(entry.logs ? entry.bytes / entry.logs : 0)}
              </td>
              <td className="py-2 pr-3">
                <StatusMix
                  byStatus={entry.byStatus}
                  total={entry.logs}
                  className="w-20"
                />
              </td>
              <td
                className="text-muted-foreground py-2 pr-3 whitespace-nowrap"
                title={formatDate(entry.firstSeen)}
              >
                {formatDate(entry.firstSeen)}
              </td>
              <td
                className="text-muted-foreground py-2 pr-3 whitespace-nowrap"
                title={formatDate(entry.lastSeen)}
              >
                {formatRelative(entry.lastSeen)}
              </td>
              <td className="py-2 pr-3">
                {together.length === 0 ? (
                  <span className="text-muted-foreground">{EMPTY}</span>
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {together.map(([other, n]) => (
                      <span
                        key={other}
                        title={`${n} logs carry both ${entry.tag} and ${other}`}
                        className={cn(
                          "border-border text-muted-foreground rounded-full border px-1.5 text-[10px]",
                        )}
                      >
                        {other}
                        <span className="ml-1 tabular-nums opacity-60">
                          {n}
                        </span>
                      </span>
                    ))}
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
