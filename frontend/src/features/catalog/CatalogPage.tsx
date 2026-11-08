// Pantalla de catalogo: filtros, tabla, paginacion y la ficha del log seleccionado.
//
// Solo el cuerpo de la tabla hace scroll; la barra de filtros y la de paginacion
// quedan fijas, para que el recuento y los controles esten siempre a la vista.

import { Database } from "@hyperloopupv/frontend-kit/icons";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getStats, listTags } from "../../api/endpoints";
import { useAuth } from "../../auth/useAuth";
import { ResultCount } from "../../components/data/ui";
import { PageHeader } from "../../components/layout/PageHeader";
import { BulkBar } from "./BulkBar";
import { ColumnControls } from "./ColumnControls";
import { csvFilename, downloadCsv } from "./exportCsv";
import { LogDetailSheet } from "./LogDetailSheet";
import { LogFilters } from "./LogFilters";
import { LogPagination } from "./LogPagination";
import { LogTable } from "./LogTable";
import { LogTableSkeleton } from "./LogTableSkeleton";
import { LogsEmpty } from "./LogsEmpty";
import { SavedViewsMenu } from "./SavedViewsMenu";
import { useBulkTags } from "./useBulkTags";
import { useLogSearch } from "./useLogSearch";
import { useSavedViews } from "./useSavedViews";
import { useTablePrefs } from "./useTablePrefs";

export function CatalogPage() {
  const { isAdmin } = useAuth();
  const search = useLogSearch();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [params, setParams] = useSearchParams();

  const { prefs, isVisible, toggleColumn, setDensity, resetColumns } =
    useTablePrefs();
  const savedViews = useSavedViews();
  const bulk = useBulkTags();

  const [selected, setSelected] = useState<Set<string>>(new Set());

  // "/" enfoca la busqueda, como en adj-view. Se ignora si ya se esta escribiendo
  // en un campo, o la tecla no se podria teclear nunca.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable)
        return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const tags = useQuery({ queryKey: ["logTags"], queryFn: listTags });
  const stats = useQuery({ queryKey: ["logStats"], queryFn: getStats });

  const { data, isPending, isError, error, isPlaceholderData } = search.query;
  const logs = useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? 0;

  // La seleccion se limpia al cambiar de pagina o de filtros. Arrastrar una
  // seleccion invisible entre paginas es la forma facil de editar en lote algo que
  // no se esta viendo.
  const pageKey = `${search.page}|${search.committedText}|${search.tags.join(",")}|${search.status}|${search.creator}|${search.from}|${search.to}|${search.driveFolder}|${search.pageSize}`;
  const [lastPageKey, setLastPageKey] = useState(pageKey);
  if (pageKey !== lastPageKey) {
    setLastPageKey(pageKey);
    if (selected.size > 0) setSelected(new Set());
    if (bulk.result) bulk.clearResult();
  }

  const toggleSelect = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((current) =>
      current.size === logs.length
        ? new Set()
        : new Set(logs.map((log) => log.id)),
    );
  }, [logs]);

  const selectedLogs = logs.filter((log) => selected.has(log.id));

  return (
    <>
      <PageHeader
        title="Catalog"
        meta={
          data && (
            <span className="text-muted-foreground flex items-center gap-2 text-[11px]">
              <ResultCount n={total} total={stats.data?.totalLogs ?? total} />
              {search.hasFilters && <span>filtered</span>}
            </span>
          )
        }
        actions={
          <>
            {logs.length > 0 && (
              <button
                type="button"
                onClick={() => downloadCsv(logs, csvFilename())}
                title="Export the rows on this page"
                className="text-muted-foreground hover:text-foreground text-[11px] underline underline-offset-2"
              >
                CSV
              </button>
            )}
            <SavedViewsMenu
              views={savedViews.views}
              currentQuery={params.toString()}
              hasFilters={search.hasFilters}
              onApply={(query) => setParams(new URLSearchParams(query))}
              onSave={(name) => savedViews.save(name, params.toString())}
              onRename={savedViews.rename}
              onRemove={savedViews.remove}
            />
            <ColumnControls
              hidden={prefs.hidden}
              density={prefs.density}
              onToggleColumn={toggleColumn}
              onDensity={setDensity}
              onReset={resetColumns}
            />
          </>
        }
      />

      <LogFilters
        search={search}
        tags={tags.data ?? []}
        stats={stats.data}
        isAdmin={isAdmin}
        searchRef={searchRef}
      />

      <div className="relative min-h-0 flex-1">
        <div className="h-full overflow-auto">
          {isPending ? (
            <LogTableSkeleton rows={search.pageSize} />
          ) : isError ? (
            <div className="px-4 py-12 text-center">
              <p className="text-destructive text-sm">
                {error instanceof Error
                  ? error.message
                  : "The catalog could not be loaded."}
              </p>
              <button
                type="button"
                onClick={() => void search.query.refetch()}
                className="text-muted-foreground hover:text-foreground mt-2 text-xs underline underline-offset-2"
              >
                try again
              </button>
            </div>
          ) : logs.length === 0 ? (
            <LogsEmpty
              hasFilters={search.hasFilters}
              onClearFilters={search.clearFilters}
              icon={Database}
            />
          ) : (
            <div
              // Mientras llega la pagina nueva se atenua la anterior: indica que
              // algo esta en curso sin vaciar la tabla ni mover el scroll.
              className={
                isPlaceholderData ? "opacity-60 transition-opacity" : undefined
              }
            >
              <div className="px-4">
                <LogTable
                  logs={logs}
                  search={search}
                  highlight={search.committedText}
                  isVisible={isVisible}
                  density={prefs.density}
                  selected={selected}
                  onToggleSelect={toggleSelect}
                  onToggleAll={toggleAll}
                />
              </div>
            </div>
          )}
        </div>

        {selectedLogs.length > 0 && (
          <BulkBar
            selectedLogs={selectedLogs}
            suggestions={tags.data ?? []}
            running={bulk.running}
            result={bulk.result}
            onApply={(mode, next) => void bulk.apply(selectedLogs, mode, next)}
            onClear={() => {
              setSelected(new Set());
              bulk.clearResult();
            }}
          />
        )}
      </div>

      <LogPagination
        page={search.page}
        pageSize={search.pageSize}
        total={total}
        onPage={search.setPage}
        onPageSize={search.setPageSize}
      />

      <LogDetailSheet
        logId={search.selectedId}
        onClose={() => search.selectLog(null)}
        onNavigate={search.moveSelection}
      />
    </>
  );
}
