// Barra de filtros del catalogo.
//
// Antes esto era una fila de catorce chips iguales donde los cuatro de estado eran
// de seleccion unica y los diez de tag de seleccion multiple: mismo aspecto, distinto
// comportamiento, y creciendo sin limite segun aparecian tags nuevos.
//
// Ahora cada filtro usa el control que le corresponde:
//
//   - Estado -> StatusFilter, un selector de opcion unica con la misma forma que el
//     parametro `status` del API. No es el SegmentedControl del kit; el porque esta
//     explicado en ese fichero.
//   - Tags -> TagEditor en modo seleccion, que se pliega en una caja de altura fija
//     y trae buscador, asi que da igual que haya diez tags o doscientos.
//   - Autor, fechas y metadatos -> dentro de un Popover, porque son los que menos se
//     tocan. El boton lleva el numero de los que estan puestos para que no se olviden
//     escondidos ahi dentro.
//
// Debajo queda una linea con lo que hay aplicado, para poder quitarlo de uno en uno.

import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@hyperloopupv/frontend-kit/components";
import { Filter } from "@hyperloopupv/frontend-kit/icons";
import { cn } from "@hyperloopupv/frontend-kit/lib";
import type { RefObject } from "react";
import type { LogStats } from "../../api/types";
import { SearchInput } from "../../components/data/ui";
import { formatMonthKey } from "../../lib/format";
import { StatusFilter } from "./StatusFilter";
import { TagEditor } from "./TagEditor";
import type { LogSearchState } from "./useLogSearch";

/** Pastilla de un filtro aplicado, con su aspa para quitarlo. */
function AppliedPill({
  label,
  value,
  onRemove,
}: {
  label: string;
  value: string;
  onRemove: () => void;
}) {
  return (
    <span className="border-border text-muted-foreground inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]">
      <span className="opacity-60">{label}</span>
      <span className="text-foreground font-medium">{value}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label} filter`}
        className="hover:text-destructive leading-none transition-colors"
      >
        ✕
      </button>
    </span>
  );
}

interface LogFiltersProps {
  search: LogSearchState;
  tags: string[];
  stats?: LogStats;
  isAdmin: boolean;
  searchRef: RefObject<HTMLInputElement | null>;
}

export function LogFilters({
  search,
  tags,
  stats,
  isAdmin,
  searchRef,
}: LogFiltersProps) {
  // Cuantos filtros viven dentro del popover, para avisar en el boton.
  // stats.byFolder ya viene agrupado por la carpeta YYYY_MM de Drive, que es
  // exactamente lo que el API espera en `driveFolder`. Se ordena al reves para que
  // los meses recientes, que son los que se buscan, salgan primero.
  const months = Object.entries(stats?.byFolder ?? {}).sort(([a], [b]) =>
    b.localeCompare(a),
  );

  const hiddenCount =
    (search.creator ? 1 : 0) +
    (search.from ? 1 : 0) +
    (search.to ? 1 : 0) +
    (search.metadataQuery ? 1 : 0) +
    (search.driveFolder ? 1 : 0);

  return (
    <div className="flex flex-col gap-2 border-b px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={search.textInput}
          onChange={search.setTextInput}
          placeholder="Search file name or note… ( / )"
          inputRef={searchRef}
        />

        <TagEditor
          value={search.tags}
          onChange={search.setTags}
          suggestions={tags}
          allowCreate={false}
          placeholder="Filter by tag…"
          className="w-[14rem] shrink-0"
        />

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-8 shrink-0 gap-1.5 text-xs",
                hiddenCount > 0 && "border-primary/40 text-primary",
              )}
            >
              <Filter className="size-3.5" />
              More filters
              {hiddenCount > 0 && (
                <span className="bg-primary/15 rounded-full px-1.5 tabular-nums">
                  {hiddenCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72">
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
                  Uploaded by
                </span>
                <Input
                  value={search.creator}
                  onChange={(event) => search.setCreator(event.target.value)}
                  placeholder="GitHub username"
                  className="h-8 text-xs shadow-none"
                />
              </label>

              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
                  Date range
                </span>
                <div className="flex items-center gap-1">
                  <Input
                    type="date"
                    value={search.from}
                    onChange={(event) => search.setFrom(event.target.value)}
                    aria-label="From date"
                    className="h-8 min-w-0 flex-1 text-xs shadow-none"
                  />
                  <span className="text-muted-foreground text-xs">→</span>
                  <Input
                    type="date"
                    value={search.to}
                    onChange={(event) => search.setTo(event.target.value)}
                    aria-label="To date"
                    className="h-8 min-w-0 flex-1 text-xs shadow-none"
                  />
                </div>
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
                  Month
                </span>
                <select
                  value={search.driveFolder}
                  onChange={(event) =>
                    search.setDriveFolder(event.target.value)
                  }
                  className="border-input bg-background h-8 rounded-md border px-2 text-xs"
                >
                  <option value="">Any month</option>
                  {months.map(([folder, count]) => (
                    <option key={folder} value={folder}>
                      {formatMonthKey(folder)} ({count})
                    </option>
                  ))}
                </select>
              </label>

              {isAdmin && (
                <label className="flex flex-col gap-1">
                  <span className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
                    Client metadata
                  </span>
                  <Input
                    value={search.metadataQuery}
                    onChange={(event) =>
                      search.setMetadataQuery(event.target.value)
                    }
                    placeholder="hostname, runUuid…"
                    className="h-8 text-xs shadow-none"
                  />
                  <span className="text-muted-foreground text-[10px]">
                    Searches inside clientMetadata. Administrators only.
                  </span>
                </label>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StatusFilter
          value={search.status}
          onChange={search.setStatus}
          byStatus={stats?.byStatus}
          total={stats?.totalLogs}
        />

        {search.tags.map((tag) => (
          <AppliedPill
            key={tag}
            label="tag"
            value={tag}
            onRemove={() => search.toggleTag(tag)}
          />
        ))}
        {search.creator && (
          <AppliedPill
            label="by"
            value={search.creator}
            onRemove={() => search.setCreator("")}
          />
        )}
        {search.from && (
          <AppliedPill
            label="from"
            value={search.from}
            onRemove={() => search.setFrom("")}
          />
        )}
        {search.to && (
          <AppliedPill
            label="to"
            value={search.to}
            onRemove={() => search.setTo("")}
          />
        )}
        {search.driveFolder && (
          <AppliedPill
            label="month"
            value={formatMonthKey(search.driveFolder)}
            onRemove={() => search.setDriveFolder("")}
          />
        )}
        {search.metadataQuery && (
          <AppliedPill
            label="metadata"
            value={search.metadataQuery}
            onRemove={() => search.setMetadataQuery("")}
          />
        )}

        {search.hasFilters && (
          <button
            type="button"
            onClick={search.clearFilters}
            className="text-muted-foreground hover:text-destructive ml-auto shrink-0 text-[10px] underline underline-offset-2"
          >
            clear filters
          </button>
        )}
      </div>
    </div>
  );
}
