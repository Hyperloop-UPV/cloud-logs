// Dashboard: el estado del archivo de un vistazo.
//
// Maquetado como el Overview de competition-view: denso, a sangre, sin ancho maximo
// centrado, con las metricas en una rejilla fija arriba y el detalle debajo.
//
// Todo lo que se pinta aqui es navegable: cada metrica, cada tramo de estado, cada
// tag y cada barra del mes llevan al catalogo con ese filtro ya aplicado.

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@hyperloopupv/frontend-kit/components";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { getStats, searchLogs } from "../../api/endpoints";
import { useColorScheme } from "../../hooks/useColorScheme";
import { PageHeader } from "../../components/layout/PageHeader";
import { formatBytes, formatCount } from "../../lib/format";
import { MetricCard } from "./MetricCard";
import { MonthlyVolumeChart } from "./MonthlyVolumeChart";
import { RecentActivity } from "./RecentActivity";
import { StatusBreakdown } from "./StatusBreakdown";
import { TopTags } from "./TopTags";

const RECENT_COUNT = 8;

/** Barras de carga de un panel, con la forma de lo que va a aparecer. */
function PanelSkeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-2 py-1">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className="h-3"
          style={{ width: `${95 - i * 12}%` }}
        />
      ))}
    </div>
  );
}

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="min-w-0 gap-3 py-4">
      <CardHeader className="flex items-center gap-2 px-4 pb-0">
        <CardTitle className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
          {title}
        </CardTitle>
        {action && <div className="ml-auto">{action}</div>}
      </CardHeader>
      <CardContent className="px-4">{children}</CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const { isDark } = useColorScheme();

  const stats = useQuery({ queryKey: ["logStats"], queryFn: getStats });
  const recent = useQuery({
    queryKey: [
      "logs",
      {
        page: 1,
        pageSize: RECENT_COUNT,
        sortBy: "createdAt",
        sortOrder: "desc",
      },
    ],
    queryFn: () =>
      searchLogs({
        page: 1,
        pageSize: RECENT_COUNT,
        sortBy: "createdAt",
        sortOrder: "desc",
      }),
  });

  const data = stats.data;
  const attention = data
    ? (data.byStatus.pending_upload ?? 0) + (data.byStatus.failed ?? 0)
    : undefined;

  return (
    <>
      <PageHeader title="Dashboard" />

      {stats.isError ? (
        <div className="px-4 py-12 text-center">
          <p className="text-destructive text-sm">
            {stats.error instanceof Error
              ? stats.error.message
              : "The metrics could not be loaded."}
          </p>
          <button
            type="button"
            onClick={() => void stats.refetch()}
            className="text-muted-foreground hover:text-foreground mt-2 text-xs underline underline-offset-2"
          >
            try again
          </button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2">
          <div className="grid shrink-0 grid-cols-2 gap-2 lg:grid-cols-4">
            <MetricCard
              label="Logs"
              value={data ? formatCount(data.totalLogs) : undefined}
              hint="in the catalog"
              to="/catalog"
            />
            <MetricCard
              label="Stored"
              value={data ? formatBytes(data.totalBytes) : undefined}
              hint="verified in Drive"
            />
            <MetricCard
              label="Tags"
              value={data ? formatCount(data.totalTags) : undefined}
              hint="distinct in use"
            />
            <MetricCard
              label="Needs attention"
              value={
                attention !== undefined ? formatCount(attention) : undefined
              }
              hint="pending or failed"
              to="/catalog?status=pending_upload"
              valueClassName={
                attention ? "text-amber-600 dark:text-amber-400" : undefined
              }
            />
          </div>

          <div className="grid min-h-0 gap-2 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Panel title="Uploads per month">
                {data && (
                  <MonthlyVolumeChart
                    byFolder={data.byFolder}
                    isDark={isDark}
                  />
                )}
              </Panel>
            </div>
            <Panel title="By status">
              {data ? (
                <StatusBreakdown byStatus={data.byStatus} />
              ) : (
                <PanelSkeleton lines={5} />
              )}
            </Panel>
          </div>

          <div className="grid min-h-0 gap-2 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Panel title="Recent uploads">
                <RecentActivity
                  logs={recent.data?.items ?? []}
                  isPending={recent.isPending}
                  error={recent.isError ? recent.error : undefined}
                  onRetry={() => void recent.refetch()}
                />
              </Panel>
            </div>
            <Panel title="Most used tags">
              {data ? (
                <TopTags tags={data.topTags} />
              ) : (
                <PanelSkeleton lines={3} />
              )}
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
