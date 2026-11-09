// Gestion del equipo y mantenimiento del catalogo. Solo para administradores.
//
// Dos salvaguardas que importan aqui:
//
// 1. No se puede uno quitar a si mismo el rol de admin. El API lo permite, y es la
//    forma mas rapida de dejar la instalacion sin nadie que pueda administrarla
//    salvo con la master key.
// 2. El cleanup se ejecuta primero en seco y enseña lo que borraria. Solo despues
//    de verlo se puede confirmar. Borra de verdad, y los `ready` no se tocan nunca,
//    pero el resto si.

import {
  Badge,
  Button,
  Card,
  CardContent,
} from "@hyperloopupv/frontend-kit/components";
import { Trash2 } from "@hyperloopupv/frontend-kit/icons";
import { cn } from "@hyperloopupv/frontend-kit/lib";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate } from "react-router-dom";
import { listUsers, runCleanup, updateUserRole } from "../../api/endpoints";
import type { CleanupResult, Role, User } from "../../api/types";
import { useAuth } from "../../auth/useAuth";
import { PlainHeader } from "../../components/data/ui";
import { PageHeader } from "../../components/layout/PageHeader";
import { formatCount, formatDateTime, formatRelative } from "../../lib/format";

function RoleBadge({ role }: { role: Role }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded px-1.5 py-0.5 text-[9px] leading-none font-bold uppercase",
        role === "admin"
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border text-muted-foreground",
      )}
    >
      {role}
    </Badge>
  );
}

function MaintenancePanel() {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<CleanupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cleanup = useMutation({
    mutationFn: (dryRun: boolean) => runCleanup({ dryRun }),
    onSuccess: (result, dryRun) => {
      setError(null);
      if (dryRun) {
        setPreview(result);
        return;
      }
      setPreview(null);
      void queryClient.invalidateQueries({ queryKey: ["logs"] });
      void queryClient.invalidateQueries({ queryKey: ["logStats"] });
      // El cleanup borra logs pending_upload, que el agregado si cuenta.
      void queryClient.invalidateQueries({ queryKey: ["tagAggregate"] });
    },
    onError: (err: unknown) => {
      setPreview(null);
      setError(err instanceof Error ? err.message : "The cleanup failed.");
    },
  });

  return (
    <Card className="gap-3 py-4">
      <CardContent className="flex flex-col gap-3 px-4">
        <div>
          <p className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
            Maintenance
          </p>
          <p className="text-muted-foreground mt-1 text-[11px]">
            Soft-deletes uploads that never completed and purges expired tokens.
            Logs that reached <span className="font-medium">ready</span> are
            never touched.
          </p>
        </div>

        {error && <p className="text-destructive text-[11px]">{error}</p>}

        {preview ? (
          <div className="border-primary/30 bg-primary/5 flex flex-col gap-2 rounded-md border p-3">
            <p className="text-xs font-medium">This is what would happen:</p>
            <ul className="text-muted-foreground flex flex-col gap-0.5 text-[11px]">
              <li>
                {formatCount(preview.orphanedCleaned)} stale uploads
                soft-deleted
              </li>
              <li>
                {formatCount(preview.softDeletedPurged)} soft-deleted logs
                purged
              </li>
              <li>
                {formatCount(preview.tokensCleaned)} refresh tokens purged
              </li>
              <li>Anything older than {formatDateTime(preview.cutoffDate)}</li>
            </ul>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="destructive"
                className="h-7 gap-1.5 text-xs"
                disabled={cleanup.isPending}
                onClick={() => cleanup.mutate(false)}
              >
                <Trash2 className="size-3.5" />
                {cleanup.isPending ? "Running…" : "Run it for real"}
              </Button>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="text-muted-foreground hover:text-foreground text-[11px] underline underline-offset-2"
              >
                cancel
              </button>
            </div>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-7 w-fit text-xs"
            disabled={cleanup.isPending}
            onClick={() => cleanup.mutate(true)}
          >
            {cleanup.isPending ? "Checking…" : "Preview cleanup"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function TeamPage() {
  const { isAdmin, user: me } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const users = useQuery({ queryKey: ["users"], queryFn: listUsers });

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) =>
      updateUserRole(id, role),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err: unknown) =>
      setError(err instanceof Error ? err.message : "The role did not change."),
  });

  // El rail ya oculta esta entrada, pero la ruta es alcanzable escribiendola.
  if (!isAdmin) return <Navigate to="/" replace />;

  const rows: User[] = users.data ?? [];

  return (
    <>
      <PageHeader
        title="Team"
        meta={
          users.data && (
            <span className="text-muted-foreground text-[11px] tabular-nums">
              {formatCount(rows.length)} members
            </span>
          )
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2">
        {error && <p className="text-destructive px-2 text-xs">{error}</p>}

        <Card className="min-w-0 gap-0 py-0">
          <CardContent className="px-4 py-2">
            {users.isPending ? (
              <p className="text-muted-foreground py-8 text-center text-xs">
                Loading…
              </p>
            ) : users.isError ? (
              <p className="text-destructive py-8 text-center text-xs">
                {users.error instanceof Error
                  ? users.error.message
                  : "The team could not be loaded."}
              </p>
            ) : (
              <table className="w-full min-w-[32rem] text-xs">
                <thead className="group/head">
                  <tr>
                    <PlainHeader label="Member" />
                    <PlainHeader label="Role" />
                    <PlainHeader label="Joined" />
                    <PlainHeader label="" align="right" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const isMe = row.id === me?.id;
                    const promote = row.role !== "admin";
                    return (
                      <tr key={row.id} className="border-b last:border-b-0">
                        <td className="py-2 pr-3 font-medium">
                          {row.username}
                          {isMe && (
                            <span className="text-muted-foreground ml-1.5 text-[10px]">
                              you
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <RoleBadge role={row.role} />
                        </td>
                        <td
                          className="text-muted-foreground py-2 pr-3"
                          title={formatDateTime(row.createdAt)}
                        >
                          {formatRelative(row.createdAt)}
                        </td>
                        <td className="py-2 text-right">
                          {isMe && row.role === "admin" ? (
                            <span
                              className="text-muted-foreground/50 text-[11px]"
                              title="Removing your own admin role would lock you out of this page."
                            >
                              —
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={changeRole.isPending}
                              onClick={() => {
                                if (
                                  promote &&
                                  !window.confirm(
                                    `Make ${row.username} an administrator? They will be able to edit any log and manage the team.`,
                                  )
                                )
                                  return;
                                changeRole.mutate({
                                  id: row.id,
                                  role: promote ? "admin" : "user",
                                });
                              }}
                              className="text-muted-foreground hover:text-foreground text-[11px] underline underline-offset-2 disabled:opacity-50"
                            >
                              {promote ? "make admin" : "revoke admin"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <MaintenancePanel />
      </div>
    </>
  );
}
