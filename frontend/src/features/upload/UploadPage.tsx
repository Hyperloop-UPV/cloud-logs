// Subida de archivos de telemetria.
//
// Los bytes van directos del navegador a Google Drive; el backend solo registra los
// metadatos y verifica al final. Por eso aqui hay barra de progreso de verdad y un
// boton de cancelar: la transferencia la lleva esta pestaña, no el servidor.
//
// Los metadatos se aplican a todos los archivos de la tanda. Si alguno necesita algo
// distinto, se corrige luego en su ficha del catalogo, que ya es editable.

import {
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Textarea,
} from "@hyperloopupv/frontend-kit/components";
import { Upload as UploadIcon } from "@hyperloopupv/frontend-kit/icons";
import { cn } from "@hyperloopupv/frontend-kit/lib";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { listTags } from "../../api/endpoints";
import { PageHeader } from "../../components/layout/PageHeader";
import { TagEditor } from "../catalog/TagEditor";
import { UploadQueue } from "./UploadQueue";
import { useUploadQueue } from "./useUploadQueue";

/** Un <input type="datetime-local"> da hora local sin zona; se pasa a ISO. */
function toIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function UploadPage() {
  const queryClient = useQueryClient();
  const queue = useUploadQueue();
  const fileInput = useRef<HTMLInputElement | null>(null);

  const [dragging, setDragging] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [rejected, setRejected] = useState<string[]>([]);

  const tagSuggestions = useQuery({ queryKey: ["logTags"], queryFn: listTags });

  const send = (fileList: FileList | null) => {
    if (!fileList) return;
    const all = Array.from(fileList);
    // El catalogo guarda archivos comprimidos; aceptar otra cosa solo produce
    // entradas que nadie podra descomprimir luego.
    const zips = all.filter((file) => file.name.toLowerCase().endsWith(".zip"));
    setRejected(
      all.filter((file) => !zips.includes(file)).map((file) => file.name),
    );
    if (zips.length === 0) return;

    queue.enqueue(
      zips,
      {
        tags,
        note: note || null,
        startDate: toIso(start),
        endDate: toIso(end),
        fileDate: toIso(start) ?? toIso(end) ?? null,
        fileHash: null,
        clientMetadata: {},
      },
      () => {
        void queryClient.invalidateQueries({ queryKey: ["logs"] });
        void queryClient.invalidateQueries({ queryKey: ["logStats"] });
        void queryClient.invalidateQueries({ queryKey: ["logTags"] });
        // El log recien subido tiene que aparecer en /tags y en el grafo.
        void queryClient.invalidateQueries({ queryKey: ["tagAggregate"] });
      },
    );
  };

  return (
    <>
      <PageHeader title="Upload" />

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2">
        <div className="grid gap-2 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                send(event.dataTransfer.files);
              }}
              className={cn(
                "flex h-full min-h-[14rem] flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-8 text-center transition-colors",
                dragging ? "border-primary bg-primary/5" : "border-border",
              )}
            >
              <UploadIcon
                className={cn(
                  "size-8",
                  dragging
                    ? "text-primary"
                    : "text-muted-foreground opacity-40",
                )}
              />
              <div>
                <p className="text-sm font-medium">
                  Drop telemetry archives here
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  ZIP files only. They go straight to Google Drive, so keep this
                  tab open until they finish.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => fileInput.current?.click()}
              >
                Choose files
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".zip,application/zip"
                multiple
                hidden
                onChange={(event) => {
                  send(event.target.files);
                  event.target.value = "";
                }}
              />
              {rejected.length > 0 && (
                <p className="text-destructive text-[11px]">
                  Skipped {rejected.length} file
                  {rejected.length === 1 ? "" : "s"} that{" "}
                  {rejected.length === 1 ? "is" : "are"} not a ZIP:{" "}
                  {rejected.join(", ")}
                </p>
              )}
            </div>
          </div>

          <Card className="gap-3 py-4">
            <CardContent className="flex flex-col gap-3 px-4">
              <p className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
                Applied to this batch
              </p>

              <div className="flex flex-col gap-1">
                <Label className="text-[11px]">Tags</Label>
                <TagEditor
                  value={tags}
                  onChange={setTags}
                  suggestions={tagSuggestions.data ?? []}
                  placeholder="pod, bms, run…"
                />
              </div>

              <div className="flex flex-col gap-1">
                <Label className="text-[11px]">Note</Label>
                <Textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  placeholder="What was this run for?"
                  className="text-xs shadow-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px]">Starts</Label>
                  <Input
                    type="datetime-local"
                    value={start}
                    onChange={(event) => setStart(event.target.value)}
                    className="h-8 text-xs shadow-none"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px]">Ends</Label>
                  <Input
                    type="datetime-local"
                    value={end}
                    onChange={(event) => setEnd(event.target.value)}
                    className="h-8 text-xs shadow-none"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {queue.items.length > 0 && (
          <UploadQueue
            items={queue.items}
            onCancel={queue.cancel}
            onDismiss={queue.dismiss}
          />
        )}
      </div>
    </>
  );
}
