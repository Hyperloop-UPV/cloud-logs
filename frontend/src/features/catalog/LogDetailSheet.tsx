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
  Separator,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Textarea,
} from "@hyperloopupv/frontend-kit/components";
import { ExternalLink, FileDown } from "@hyperloopupv/frontend-kit/icons";
import { cn } from "@hyperloopupv/frontend-kit/lib";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { downloadUrl, getLog, updateLog } from "../../api/endpoints";
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

  // El backend deja editar al dueno, al admin y a la master key
  // (logs.py::check_log_modification_permission). Se replica aqui para no ofrecer
  // un formulario que va a devolver 403, pero el 403 se maneja igual por si la
  // comprobacion local y la del servidor no coinciden.
  const canEdit = Boolean(
    log && (isAdmin || (user && log.createdBy === user.id)),
  );

  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [draftNote, setDraftNote] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Al cambiar de log se recarga el borrador desde el servidor.
  const [loadedId, setLoadedId] = useState<string | null>(null);
  if (log && log.id !== loadedId) {
    setLoadedId(log.id);
    setDraftTags(log.tags);
    setDraftNote(log.note ?? "");
    setDirty(false);
    setSaveError(null);
  }

  const save = useMutation({
    mutationFn: (payload: { tags: string[]; note: string }) =>
      updateLog(log!.id, { tags: payload.tags, note: payload.note }),
    onSuccess: (updated: Log) => {
      queryClient.setQueryData(["log", updated.id], updated);
      void queryClient.invalidateQueries({ queryKey: ["logs"] });
      void queryClient.invalidateQueries({ queryKey: ["logTags"] });
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
              <div className="flex items-start gap-2">
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

                {canEdit ? (
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
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
