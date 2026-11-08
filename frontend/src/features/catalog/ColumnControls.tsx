// Que columnas se ven y como de apretada va la tabla.
//
// Va en un Popover y no suelto en la barra: se toca una vez y se olvida, asi que no
// merece ocupar sitio permanente al lado de los filtros, que se usan constantemente.

import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SegmentedControl,
} from "@hyperloopupv/frontend-kit/components";
import { Columns } from "@hyperloopupv/frontend-kit/icons";
import { cn } from "@hyperloopupv/frontend-kit/lib";
import { COLUMNS } from "./useTablePrefs";
import type { ColumnId, Density } from "./useTablePrefs";

interface ColumnControlsProps {
  hidden: ColumnId[];
  density: Density;
  onToggleColumn: (id: ColumnId) => void;
  onDensity: (density: Density) => void;
  onReset: () => void;
}

export function ColumnControls({
  hidden,
  density,
  onToggleColumn,
  onDensity,
  onReset,
}: ColumnControlsProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          title="Columns and density"
          className={cn(
            "h-7 gap-1.5 text-xs",
            hidden.length > 0 && "text-primary",
          )}
        >
          <Columns className="size-3.5" />
          {hidden.length > 0 && (
            <span className="tabular-nums">{hidden.length} hidden</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
              Density
            </span>
            <SegmentedControl
              options={[
                { label: "Comfortable", value: "comfortable" as Density },
                { label: "Compact", value: "compact" as Density },
              ]}
              value={density}
              onChange={onDensity}
              className="[&_button]:px-2 [&_button]:py-0.5 [&_button]:text-[11px]"
            />
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
                Columns
              </span>
              {hidden.length > 0 && (
                <button
                  type="button"
                  onClick={onReset}
                  className="text-muted-foreground hover:text-foreground text-[10px] underline underline-offset-2"
                >
                  show all
                </button>
              )}
            </div>

            {COLUMNS.map((column) => {
              const visible = !hidden.includes(column.id);
              return (
                <label
                  key={column.id}
                  className="hover:bg-muted/40 flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={visible}
                    onChange={() => onToggleColumn(column.id)}
                    className="accent-primary size-3"
                  />
                  <span className={cn(!visible && "text-muted-foreground")}>
                    {column.label}
                  </span>
                </label>
              );
            })}
            <p className="text-muted-foreground mt-1 text-[10px]">
              File name and download are always shown.
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
