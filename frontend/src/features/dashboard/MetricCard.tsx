// Metrica suelta del dashboard.
//
// Adaptada de competition-view/src/pages/Overview/components/MetricCard.tsx: misma
// etiqueta en versalitas espaciadas y mismo valor grande en tabular-nums, para que
// las dos apps se lean igual. Lo que se anade aqui es que la tarjeta pueda ser un
// enlace: cada metrica lleva al catalogo con su filtro puesto, porque un resumen
// que no lleva a ningun sitio es decoracion.

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@hyperloopupv/frontend-kit/components";
import { cn } from "@hyperloopupv/frontend-kit/lib";
import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { EMPTY } from "../../lib/format";

interface MetricCardProps {
  label: string;
  value: string | number | undefined;
  unit?: string;
  /** Linea pequena debajo del valor. */
  hint?: ReactNode;
  /** Si se da, la tarjeta entera navega aqui. */
  to?: string;
  valueClassName?: string;
}

export function MetricCard({
  label,
  value,
  unit,
  hint,
  to,
  valueClassName,
}: MetricCardProps) {
  const display = value !== undefined ? String(value) : EMPTY;

  const body = (
    <Card
      className={cn(
        "h-full gap-2 py-4",
        to && "hover:border-primary/40 transition-colors",
      )}
    >
      <CardHeader className="px-4 pb-0">
        <CardTitle className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <p
          className={cn(
            "text-foreground text-3xl font-bold tabular-nums",
            valueClassName,
          )}
        >
          {display}
          {value !== undefined && unit && (
            <span className="text-muted-foreground ml-1 text-sm font-normal">
              {unit}
            </span>
          )}
        </p>
        {hint && (
          <p className="text-muted-foreground mt-1 text-[11px]">{hint}</p>
        )}
      </CardContent>
    </Card>
  );

  return to ? (
    <Link to={to} className="block focus-visible:outline-none">
      {body}
    </Link>
  ) : (
    body
  );
}
