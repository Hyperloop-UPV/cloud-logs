// Filtro de estado: una sola opcion de las cinco.
//
// No usa el SegmentedControl del kit, aunque la semantica encaje. Ese componente
// reparte el ancho a partes iguales (`width: 100/n %`) porque su indicador
// deslizante se mueve con `translateX(100% * i)`, y eso solo cuadra si todos los
// segmentos miden lo mismo. Aqui las etiquetas llevan la cuenta pegada ("Ready 54",
// "Pending 2"), asi que tienen longitudes distintas: forzadas al mismo ancho, las
// largas parten en dos lineas y el conjunto queda dentado, con las lineas base sin
// alinear. Ademas `label` es un `string`, asi que la cuenta no puede ir en un span
// atenuado.
//
// Se conserva el lenguaje visual del kit (caja `bg-muted`, activo en `bg-background`
// con sombra) y se cambia solo el reparto: cada segmento mide lo que mide su texto.
// Se renuncia al deslizamiento del indicador, que es lo que obligaba al ancho fijo.

import { cn } from "@hyperloopupv/frontend-kit/lib";
import type { LogStatus } from "../../api/types";
import { formatCount } from "../../lib/format";
import { statusStyles, STATUS_ORDER } from "./statusStyles";

interface StatusFilterProps {
  /** null = todos. */
  value: LogStatus | null;
  onChange: (next: LogStatus | null) => void;
  /** Recuento por estado; undefined mientras cargan las estadisticas. */
  byStatus?: Partial<Record<LogStatus, number>>;
  total?: number;
}

export function StatusFilter({
  value,
  onChange,
  byStatus,
  total,
}: StatusFilterProps) {
  const options = [
    {
      key: "all" as const,
      label: "All",
      count: total,
      mark: null,
      title: "Every log in the catalog",
    },
    ...STATUS_ORDER.map((status) => ({
      key: status,
      label: statusStyles[status].label,
      count: byStatus?.[status],
      mark: statusStyles[status].markClass,
      title: statusStyles[status].description,
    })),
  ];

  return (
    <div
      role="group"
      aria-label="Filter by status"
      // max-w-full + scroll en lugar de shrink-0: ahora que los segmentos no
      // parten, en una pantalla estrecha el control desbordaria la pagina entera.
      // Asi se encoge y se desplaza por dentro.
      className="bg-muted inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg p-0.5"
    >
      {options.map((option) => {
        const active =
          option.key === "all" ? value === null : value === option.key;
        return (
          <button
            key={option.key}
            type="button"
            aria-pressed={active}
            title={option.title}
            onClick={() =>
              onChange(option.key === "all" ? null : (option.key as LogStatus))
            }
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium whitespace-nowrap transition-colors",
              active
                ? "bg-background text-foreground cursor-default shadow-sm"
                : "text-muted-foreground hover:text-foreground cursor-pointer",
            )}
          >
            {/* El punto repite el color de la barra del borde de la fila, que es
                de donde se lee el estado en la tabla. */}
            {option.mark && (
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  option.mark,
                  !active && "opacity-50",
                )}
              />
            )}
            {option.label}
            {option.count !== undefined && (
              <span
                className={cn(
                  "text-[10px] tabular-nums",
                  active ? "text-muted-foreground" : "opacity-60",
                )}
              >
                {formatCount(option.count)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
