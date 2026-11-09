// Vista de grafo del archivo, como pantalla propia.
//
// Comparte el agregado con la pantalla de etiquetas (useTagAggregate vive alli, en
// features/tags/) y eso es deliberado: las dos vistas usan la misma clave de
// react-query, asi que saltar de una a otra **no vuelve a barrer el catalogo**.
// Duplicar el hook aqui costaria un segundo barrido completo por nada.
//
// El grafo quiere todo el alto que haya, asi que esta pantalla es una columna flex
// sin scroll: la cabecera no se encoge y el lienzo se queda con el resto.

import { Button, Skeleton } from "@hyperloopupv/frontend-kit/components";
import { Database, RefreshCw } from "@hyperloopupv/frontend-kit/icons";
import { cn } from "@hyperloopupv/frontend-kit/lib";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState } from "../../components/data/ui";
import { PageHeader } from "../../components/layout/PageHeader";
import { formatCount } from "../../lib/format";
import { useTagAggregate } from "../tags/useTagAggregate";
import { GraphCanvas } from "./GraphCanvas";

export function GraphPage() {
  const navigate = useNavigate();
  const { data, isPending, isError, error, refetch, isFetching } =
    useTagAggregate();

  const tags = useMemo(() => data?.tags ?? [], [data]);
  const logs = useMemo(() => data?.logs ?? [], [data]);
  // Los logs sin etiqueta no se dibujan, asi que la cifra de la cabecera cuenta
  // los que si: decir el total seria prometer mas nodos de los que hay.
  const drawable = useMemo(
    () => logs.filter((log) => log.tags.length > 0).length,
    [logs],
  );

  return (
    <>
      <PageHeader
        title="Graph"
        meta={
          data && (
            <span className="text-muted-foreground flex items-center gap-2 text-[11px]">
              <span className="tabular-nums">
                {formatCount(drawable)} tagged logs
              </span>
              <span className="opacity-50">·</span>
              <span className="tabular-nums">
                {formatCount(tags.length)} tags
              </span>
            </span>
          )
        }
        actions={
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
        }
      />

      {/* Si el barrido se corta, hay que saberlo antes de leer el dibujo: un grafo
          parcial se ve igual de completo que uno entero. */}
      {data?.truncated && (
        <p className="shrink-0 border-b bg-amber-500/10 px-4 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
          Drawn from the {formatCount(data.scanned)} most recent logs of{" "}
          {formatCount(data.total)}.
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {isPending ? (
          <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
            <Skeleton className="min-h-0 flex-1 rounded-xl" />
          </div>
        ) : isError ? (
          <div className="px-4 py-12 text-center">
            <p className="text-destructive text-sm">
              {error instanceof Error
                ? error.message
                : "The graph could not be built."}
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="text-muted-foreground hover:text-foreground mt-2 text-xs underline underline-offset-2"
            >
              try again
            </button>
          </div>
        ) : drawable === 0 ? (
          <EmptyState
            icon={Database}
            text="Nothing to draw yet. The graph joins logs to their tags, so tag a log from the catalog and it will appear here."
          />
        ) : (
          <GraphCanvas
            tags={tags}
            logs={logs}
            onPickTag={(tag) =>
              navigate(`/catalog?tags=${encodeURIComponent(tag)}`)
            }
            onPickLog={(id) => navigate(`/catalog?log=${id}`)}
          />
        )}
      </div>
    </>
  );
}
