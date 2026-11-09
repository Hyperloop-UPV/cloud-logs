// Etiquetas como coleccion de tarjetas.
//
// Una tarjeta por etiqueta, ordenadas por volumen archivado. La jerarquia dentro de
// cada una va de lo identificativo a lo accesorio: nombre, cuanto pesa, de que esta
// hecho (reparto por estado) y con que suele ir acompañada.
//
// El tamaño se escribe grande porque es la pregunta que trae a alguien aqui: cuanto
// archivo cuelga de cada etiqueta.

import { Card, CardContent } from "@hyperloopupv/frontend-kit/components";
import { formatBytes, formatCount, formatRelative } from "../../lib/format";
import { StatusMix } from "./StatusMix";
import type { TagAggregate } from "./useTagAggregate";

export function TagCards({
  tags,
  onPick,
}: {
  tags: TagAggregate[];
  onPick: (tag: string) => void;
}) {
  const sorted = [...tags].sort((a, b) => b.bytes - a.bytes);

  return (
    <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {sorted.map((entry) => {
        const together = [...entry.coOccurring.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4);
        return (
          <Card
            key={entry.tag}
            role="button"
            tabIndex={0}
            onClick={() => onPick(entry.tag)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onPick(entry.tag);
              }
            }}
            title={`Show the ${entry.logs} logs tagged ${entry.tag}`}
            className="hover:border-primary/40 focus-visible:ring-ring cursor-pointer gap-0 py-3 transition-colors outline-none focus-visible:ring-1"
          >
            <CardContent className="flex flex-col gap-2 px-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-semibold">
                  {entry.tag}
                </span>
                <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">
                  {formatCount(entry.logs)} logs
                </span>
              </div>

              <span className="font-mono text-lg leading-none tabular-nums">
                {formatBytes(entry.bytes)}
              </span>

              <StatusMix byStatus={entry.byStatus} total={entry.logs} />

              {together.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {together.map(([other, n]) => (
                    <span
                      key={other}
                      title={`${n} logs carry both ${entry.tag} and ${other}`}
                      className="border-border text-muted-foreground rounded-full border px-1.5 text-[10px]"
                    >
                      {other}
                      <span className="ml-1 tabular-nums opacity-60">{n}</span>
                    </span>
                  ))}
                </div>
              )}

              <span className="text-muted-foreground text-[10px]">
                Last used {formatRelative(entry.lastSeen)}
              </span>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
