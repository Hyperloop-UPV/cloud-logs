// Ficha completa de un log, en panel lateral.
//
// El id vive en la query string (?log=<uuid>), no en el estado del componente: asi
// el panel sobrevive a una recarga, se comparte por enlace y no tira la busqueda que
// hay detras. Es la misma regla que ya sigue el resto del catalogo.
//
// Aqui aparece todo lo que la tabla no puede enseñar sin volverse ilegible: el hash,
// la carpeta y el fichero de Drive, las fechas de registro y verificacion, y sobre
// todo clientMetadata, que es lo que dice en que maquina y en que condiciones se
// capturo el run.

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Separator,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Textarea,
} from "@hyperloopupv/frontend-kit/components";
import {
  ExternalLink,
  FileDown,
  Trash2,
} from "@hyperloopupv/frontend-kit/icons";
import { cn } from "@hyperloopupv/frontend-kit/lib";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { deleteLog, downloadUrl, getLog, updateLog } from "../../api/endpoints";
import type { Log } from "../../api/types";
import { useAuth } from "../../auth/useAuth";
import { TagEditor } from "./TagEditor";
import {
  EMPTY,
  formatBytes,
  formatDateTime,
  formatDuration,
  formatRelative,
} from "../../lib/format";
import { statusStyle } from "./statusStyles";

/** Boton de copiar que confirma en el sitio, sin necesitar un sistema de avisos. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => setCopied(true));
      }}
      className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
    >
      {copied ? (
        <Check className="size-3 text-emerald-500" />
      ) : (
        <Copy className="size-3" />
      )}
    </button>
  );
}

/** Par clave/valor de la ficha. */
function Row({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-baseline gap-2 py-1">
      <dt className="text-muted-foreground text-[11px]">{label}</dt>
      <dd
        className={cn(
          "min-w-0 text-xs break-words",
          mono && "font-mono text-[11px]",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

interface LogDetailSheetProps {
  logId: string | null;
  onClose: () => void;
  /** Fila anterior/siguiente en la tabla, para recorrerlas con el teclado. */
  onNavigate?: (direction: -1 | 1) => void;
}

export function LogDetailSheet({
  logId,
  onClose,
  onNavigate,
}: LogDetailSheetProps) {
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();

  const detail = useQuery({
    queryKey: ["log", logId],
    queryFn: () => getLog(logId as string),
    enabled: Boolean(logId),
  });

  const log = detail.data;

  // El backend aplica la MISMA regla a editar y a borrar: dueño, admin o master
  // (logs.py::check_log_modification_permission, que usan tanto PATCH como
  // DELETE). Por eso hay un solo permiso y no dos. Se replica aqui para no
  // ofrecer acciones que van a devolver 403, pero el 403 se maneja igual por si
  // la comprobacion local y la del servidor no coinciden.
  const canModify = Boolean(
    log && (isAdmin || (user && log.createdBy === user.id)),
  );

  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [draftNote, setDraftNote] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Al cambiar de log se recarga el borrador desde el servidor.
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  if (log && log.id !== loadedId) {
    setLoadedId(log.id);
    setDraftTags(log.tags);
    setDraftNote(log.note ?? "");
    setDirty(false);
    setSaveError(null);
    setConfirmDelete(false);
    setDeleteError(null);
  }

  const save = useMutation({
    mutationFn: (payload: { tags: string[]; note: string }) =>
      updateLog(log!.id, { tags: payload.tags, note: payload.note }),
    onSuccess: (updated: Log) => {
      queryClient.setQueryData(["log", updated.id], updated);
      void queryClient.invalidateQueries({ queryKey: ["logs"] });
      void queryClient.invalidateQueries({ queryKey: ["logTags"] });
      // Cambiar las etiquetas de un log cambia el agregado de /tags y /graph.
      void queryClient.invalidateQueries({ queryKey: ["tagAggregate"] });
      setDirty(false);
      setSaveError(null);
    },
    onError: (error: unknown) => {
      setSaveError(
        error instanceof ApiError && error.status === 403
          ? "You can only edit logs you uploaded."
          : error instanceof Error
            ? error.message
            : "The changes could not be saved.",
      );
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteLog(log!.id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["log", log!.id] });
      void queryClient.invalidateQueries({ queryKey: ["logs"] });
      void queryClient.invalidateQueries({ queryKey: ["logStats"] });
      void queryClient.invalidateQueries({ queryKey: ["logTags"] });
      // La clave que alimentan /tags y /graph. Sin esto el log borrado seguiria
      // dibujandose como un nodo del grafo.
      void queryClient.invalidateQueries({ queryKey: ["tagAggregate"] });
      setConfirmDelete(false);
      onClose();
    },
    onError: (error: unknown) => {
      // Un 404 significa que ya no esta: el estado que se queria ya se cumple,
      // asi que se trata como exito en vez de dar un error que no deja hacer nada.
      if (error instanceof ApiError && error.status === 404) {
        queryClient.removeQueries({ queryKey: ["log", log!.id] });
        void queryClient.invalidateQueries({ queryKey: ["logs"] });
        setConfirmDelete(false);
        onClose();
        return;
      }
      setDeleteError(
        error instanceof ApiError && error.status === 403
          ? "You can only delete logs you uploaded."
          : error instanceof Error
            ? error.message
            : "The log could not be deleted.",
      );
    },
  });

  // Las flechas recorren la tabla sin cerrar el panel.
  useEffect(() => {
    if (!logId || !onNavigate) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable)
        return;
      event.preventDefault();
      onNavigate(event.key === "ArrowDown" ? 1 : -1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [logId, onNavigate]);

  const style = log ? statusStyle(log.status) : null;
  const metadata = Object.entries(log?.clientMetadata ?? {});

  return (
    <Sheet open={Boolean(logId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 sm:w-[30rem]">
        {detail.isPending ? (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            Loading…
          </div>
        ) : detail.isError || !log || !style ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-destructive text-sm">
              {detail.error instanceof Error
                ? detail.error.message
                : "This log could not be loaded."}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
            >
              close
            </button>
          </div>
        ) : (
          <>
            <SheetHeader className="gap-1">
              {/* pr-6 para el boton de cerrar del kit, que es `absolute top-4
                  right-4` y por tanto no esta en el flujo: sin reservarle sitio
                  se le monta encima al badge de estado. 16 px de icono mas 8 de
                  hueco, medidos sobre el sheet.tsx del kit. */}
              <div className="flex items-start gap-2 pr-6">
                <span
                  className={cn("mt-1.5 h-4 w-[3px] shrink-0", style.markClass)}
                />
                <div className="min-w-0 flex-1">
                  <SheetTitle className="truncate text-sm" title={log.fileName}>
                    {log.fileName}
                  </SheetTitle>
                  <SheetDescription className="text-[11px]">
                    Uploaded by {log.creator} ·{" "}
                    <span title={formatDateTime(log.createdAt)}>
                      {formatRelative(log.createdAt)}
                    </span>
                  </SheetDescription>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "shrink-0 gap-1 rounded px-1.5 py-0.5 text-[9px] leading-none font-bold uppercase",
                    style.badgeClass,
                  )}
                  title={style.description}
                >
                  <style.icon className="size-2.5 shrink-0" />
                  {style.label}
                </Badge>
              </div>

              <div className="mt-2 flex items-center gap-2">
                {log.status === "ready" ? (
                  <Button size="sm" className="h-7 gap-1.5 text-xs" asChild>
                    <a
                      href={downloadUrl(log.id)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <FileDown className="size-3.5" />
                      Download
                    </a>
                  </Button>
                ) : (
                  <Button size="sm" className="h-7 gap-1.5 text-xs" disabled>
                    <FileDown className="size-3.5" />
                    Download
                  </Button>
                )}
                {log.driveUrl && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 text-xs"
                    asChild
                  >
                    <a href={log.driveUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-3.5" />
                      Drive
                    </a>
                  </Button>
                )}
              </div>
            </SheetHeader>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6">
              <section>
                <dl>
                  <Row label="Window">
                    {log.startDate || log.endDate ? (
                      <>
                        {formatDateTime(log.startDate)} →{" "}
                        {formatDateTime(log.endDate)}
                      </>
                    ) : (
                      EMPTY
                    )}
                  </Row>
                  <Row label="Duration">
                    {formatDuration(log.startDate, log.endDate)}
                  </Row>
                  <Row label="Captured">{formatDateTime(log.fileDate)}</Row>
                  <Row label="Size">{formatBytes(log.fileSize)}</Row>
                  <Row label="Registered">{formatDateTime(log.createdAt)}</Row>
                  <Row label="Verified">{formatDateTime(log.completedAt)}</Row>
                </dl>
              </section>

              <Separator />

              <section>
                <p className="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wider uppercase">
                  Storage
                </p>
                <dl>
                  <Row label="Drive folder">{log.driveFolder ?? EMPTY}</Row>
                  <Row label="Drive file" mono>
                    {log.driveFileId ? (
                      <span className="flex items-center gap-1.5">
                        <span className="truncate">{log.driveFileId}</span>
                        <CopyButton
                          value={log.driveFileId}
                          label="Drive file id"
                        />
                      </span>
                    ) : (
                      EMPTY
                    )}
                  </Row>
                  <Row label="SHA-256" mono>
                    {log.fileHash ? (
                      <span className="flex items-start gap-1.5">
                        <span className="min-w-0 break-all">
                          {log.fileHash}
                        </span>
                        <CopyButton value={log.fileHash} label="hash" />
                      </span>
                    ) : (
                      EMPTY
                    )}
                  </Row>
                  <Row label="Log id" mono>
                    <span className="flex items-center gap-1.5">
                      <span className="truncate">{log.id}</span>
                      <CopyButton value={log.id} label="log id" />
                    </span>
                  </Row>
                </dl>
              </section>

              <Separator />

              <section>
                <p className="text-muted-foreground mb-2 text-[10px] font-semibold tracking-wider uppercase">
                  Tags and note
                </p>

                {canModify ? (
                  <div className="flex flex-col gap-2">
                    <TagEditor
                      value={draftTags}
                      onChange={(next) => {
                        setDraftTags(next);
                        setDirty(true);
                      }}
                    />
                    <Textarea
                      value={draftNote}
                      onChange={(event) => {
                        setDraftNote(event.target.value);
                        setDirty(true);
                      }}
                      placeholder="Add a note…"
                      rows={3}
                      className="text-xs shadow-none"
                    />
                    {saveError && (
                      <p className="text-destructive text-[11px]">
                        {saveError}
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        disabled={!dirty || save.isPending}
                        onClick={() =>
                          save.mutate({ tags: draftTags, note: draftNote })
                        }
                      >
                        {save.isPending ? "Saving…" : "Save changes"}
                      </Button>
                      {dirty && (
                        <button
                          type="button"
                          onClick={() => {
                            setDraftTags(log.tags);
                            setDraftNote(log.note ?? "");
                            setDirty(false);
                            setSaveError(null);
                          }}
                          className="text-muted-foreground hover:text-foreground text-[11px] underline underline-offset-2"
                        >
                          discard
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap gap-1">
                      {log.tags.length === 0 ? (
                        <span className="text-muted-foreground text-xs">
                          {EMPTY}
                        </span>
                      ) : (
                        log.tags.map((tag) => (
                          <span
                            key={tag}
                            className="border-border text-muted-foreground rounded-full border px-2 py-0.5 text-[10px]"
                          >
                            {tag}
                          </span>
                        ))
                      )}
                    </div>
                    <p className="text-xs">{log.note || EMPTY}</p>
                    <p className="text-muted-foreground text-[11px]">
                      Only the person who uploaded a log, or an administrator,
                      can edit it.
                    </p>
                  </div>
                )}
              </section>

              {metadata.length > 0 && (
                <>
                  <Separator />
                  <section>
                    <p className="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wider uppercase">
                      Client metadata
                    </p>
                    <dl>
                      {metadata.map(([key, value]) => (
                        <Row key={key} label={key} mono>
                          {typeof value === "object" && value !== null
                            ? JSON.stringify(value)
                            : String(value)}
                        </Row>
                      ))}
                    </dl>
                  </section>
                </>
              )}

              {/* Borrar va al final y aparte, no en la fila de Download: una
                  accion destructiva pegada al boton primario se pulsa sin
                  querer. El texto dice el alcance antes de abrir nada — lo que
                  se borra es la ficha del catalogo, no el ZIP de Drive. */}
              {canModify && (
                <>
                  <Separator />
                  <section>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDeleteError(null);
                        setConfirmDelete(true);
                      }}
                      className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-7 gap-1.5 text-xs"
                    >
                      <Trash2 className="size-3.5" />
                      Delete from catalog
                    </Button>
                  </section>
                </>
              )}
            </div>
          </>
        )}
        {/* La confirmacion dice las dos cosas que no son obvias y que el usuario
            necesita para decidir: que el ZIP de Drive sigue donde esta
            (delete_log no llama a Drive, solo marca la fila) y que desde la app
            no hay vuelta atras, porque el API no expone restaurar.

            Sin pedir que teclee el nombre: la fila no se destruye de verdad
            —queda con deleted_at puesto— asi que exigir transcripcion seria
            desproporcionado para lo que realmente pasa. */}
        {log && (
          <Dialog
            open={confirmDelete}
            onOpenChange={(open) => {
              if (remove.isPending) return;
              setConfirmDelete(open);
              if (!open) setDeleteError(null);
            }}
          >
            <DialogContent className="sm:max-w-[26rem]">
              <DialogHeader>
                <DialogTitle className="text-base">
                  Delete this log from the catalog?
                </DialogTitle>
                <DialogDescription asChild>
                  <div className="space-y-2 text-xs">
                    <p className="text-foreground font-medium break-all">
                      {log.fileName}
                    </p>
                    <p>
                      The archive stays in Google Drive — only its catalog entry
                      is removed. Nobody will be able to find it through this
                      app.
                    </p>
                    <p>
                      This cannot be undone from here. An administrator can
                      still recover it from the database.
                    </p>
                  </div>
                </DialogDescription>
              </DialogHeader>

              {deleteError && (
                <p className="text-destructive text-xs">{deleteError}</p>
              )}

              <DialogFooter className="gap-2 sm:gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={remove.isPending}
                  onClick={() => setConfirmDelete(false)}
                >
                  Keep it
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate()}
                >
                  <Trash2 className="size-3.5" />
                  {remove.isPending ? "Deleting…" : "Delete from catalog"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </SheetContent>
    </Sheet>
  );
}
