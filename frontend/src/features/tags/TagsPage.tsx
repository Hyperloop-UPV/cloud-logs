// Pantalla de etiquetas, en tres modos.
//
// El modo vive en la URL (?view=cards|table|graph), como el resto de las busquedas
// de la aplicacion: asi una vista concreta se comparte por enlace.
//
// Las cifras se calculan en el cliente porque el API no agrega por etiqueta (ver
// useTagAggregate.ts). Cuando el barrido se corta por el tope, la pantalla lo dice:
// enseñar cifras parciales como si fueran el total seria mentir sobre el archivo.

import { Button, Skeleton } from "@hyperloopupv/frontend-kit/components";
import { Columns, Database, RefreshCw } from "@hyperloopupv/frontend-kit/icons";
import { LayoutGrid } from "lucide-react";
import { cn } from "@hyperloopupv/frontend-kit/lib";
import { useMemo } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { EmptyState } from "../../components/data/ui";
import { PageHeader } from "../../components/layout/PageHeader";
import { formatBytes, formatCount } from "../../lib/format";
import { TagCards } from "./TagCards";
import { TagTable } from "./TagTable";
import { useTagAggregate } from "./useTagAggregate";

type View = "cards" | "table";

const VIEWS: { id: View; label: string; icon: typeof Columns }[] = [
  { id: "cards", label: "Cards", icon: LayoutGrid },
  { id: "table", label: "Table", icon: Columns },
];

/** Conmutador compacto; no usa el SegmentedControl del kit por lo de siempre:
 *  reparte el ancho a partes iguales y aqui las etiquetas miden distinto. */
function Switch<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="bg-muted inline-flex items-center gap-0.5 rounded-lg p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            "rounded-md px-2 py-1 text-[11px] font-medium whitespace-nowrap transition-colors",
            value === option.id
              ? "bg-background text-foreground cursor-default shadow-sm"
              : "text-muted-foreground hover:text-foreground cursor-pointer",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function TagsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { data, isPending, isError, error, refetch, isFetching } =
    useTagAggregate();

  const raw = params.get("view") ?? "cards";
  const view = raw as View;

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  };

  const tags = useMemo(() => data?.tags ?? [], [data]);
  const openInCatalog = (tag: string) =>
    navigate(`/catalog?tags=${encodeURIComponent(tag)}`);

  const totalBytes = tags.reduce((sum, entry) => sum + entry.bytes, 0);

  // El grafo fue un modo de esta pantalla antes de tener la suya. Los enlaces y
  // marcadores con ?view=graph siguen funcionando en vez de caer en las tarjetas
  // sin explicacion.
  if (raw === "graph") return <Navigate to="/graph" replace />;

  return (
    <>
      <PageHeader
        title="Tags"
        meta={
          data && (
            <span className="text-muted-foreground flex items-center gap-2 text-[11px]">
              <span className="tabular-nums">
                {formatCount(tags.length)} tags
              </span>
              <span className="opacity-50">·</span>
              <span className="tabular-nums">{formatBytes(totalBytes)}</span>
            </span>
          )
        }
        actions={
          <>
            <Switch
              options={VIEWS.map((v) => ({ id: v.id, label: v.label }))}
              value={view}
              onChange={(next) => set({ view: next })}
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => void refetch()}
              disabled={isFetching}
              title="Recalculate from the catalog"
            >
              <RefreshCw
                className={cn("size-3.5", isFetching && "animate-spin")}
              />
            </Button>
          </>
        }
      />

      {/* El aviso de barrido parcial va arriba del todo: si las cifras no son el
          total, hay que saberlo antes de leerlas, no despues. */}
      {data?.truncated && (
        <p className="shrink-0 border-b bg-amber-500/10 px-4 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
          Showing the {formatCount(data.scanned)} most recent logs of{" "}
          {formatCount(data.total)}. Totals below cover only those.
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {isPending ? (
          <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        ) : isError ? (
          <div className="px-4 py-12 text-center">
            <p className="text-destructive text-sm">
              {error instanceof Error
                ? error.message
                : "Tags could not be calculated."}
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="text-muted-foreground hover:text-foreground mt-2 text-xs underline underline-offset-2"
            >
              try again
            </button>
          </div>
        ) : tags.length === 0 ? (
          <EmptyState
            icon={Database}
            text="No tags yet. Tag a log from the catalog and it will show up here."
          />
        ) : view === "cards" ? (
          <TagCards tags={tags} onPick={openInCatalog} />
        ) : view === "table" ? (
          <div className="px-4">
            <TagTable tags={tags} onPick={openInCatalog} />
          </div>
        ) : (
          <TagCards tags={tags} onPick={openInCatalog} />
        )}

        {/* Los logs sin etiqueta no salen en ninguna de las tres vistas, asi que
            se nombran: si no, parecen no existir. */}
        {data && data.untagged > 0 && (
          <p className="text-muted-foreground shrink-0 px-4 pb-4 text-[11px]">
            {formatCount(data.untagged)} logs have no tags and are not counted
            here.{" "}
            <button
              type="button"
              onClick={() => navigate("/catalog")}
              className="hover:text-foreground underline underline-offset-2"
            >
              See the catalog
            </button>
          </p>
        )}
      </div>
    </>
  );
}
