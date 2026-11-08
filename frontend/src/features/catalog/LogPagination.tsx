// Paginacion explicita.
//
// El kit no trae paginacion y el resto de las vistas del equipo no paginan, pero el
// API pagina por offset y aqui interesa que la posicion quepa en la URL: un run
// concreto se vuelve a encontrar compartiendo el enlace.
//
// La ventana de numeros se mantiene fija (como mucho 5) para que la barra no cambie
// de ancho al navegar.

import { Button } from "@hyperloopupv/frontend-kit/components";
import { ChevronLeft, ChevronRight } from "@hyperloopupv/frontend-kit/icons";
import { cn } from "@hyperloopupv/frontend-kit/lib";
import { PAGE_SIZES } from "./useLogSearch";

const WINDOW = 5;

function pageWindow(current: number, last: number): number[] {
  const start = Math.max(
    1,
    Math.min(current - Math.floor(WINDOW / 2), last - WINDOW + 1),
  );
  const from = Math.max(1, start);
  const count = Math.min(WINDOW, last - from + 1);
  return Array.from({ length: count }, (_, i) => from + i);
}

interface LogPaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}

export function LogPagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
}: LogPaginationProps) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t px-4 py-2">
      <span className="text-muted-foreground text-[11px] tabular-nums">
        {total === 0 ? "No logs" : `${first}–${last} of ${total}`}
      </span>

      <label className="text-muted-foreground ml-2 flex items-center gap-1 text-[11px]">
        Per page
        <select
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          className="border-input bg-background h-6 rounded border px-1 text-[11px] tabular-nums"
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>

      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </Button>

        {pageWindow(page, lastPage).map((n) => (
          <Button
            key={n}
            variant={n === page ? "default" : "ghost"}
            size="icon-sm"
            onClick={() => onPage(n)}
            aria-current={n === page ? "page" : undefined}
            className={cn(
              "tabular-nums",
              n !== page && "text-muted-foreground",
            )}
          >
            {n}
          </Button>
        ))}

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onPage(page + 1)}
          disabled={page >= lastPage}
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
