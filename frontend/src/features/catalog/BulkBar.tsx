// Barra de acciones sobre la seleccion.
//
// Flota sobre la tabla en vez de empujarla: aparece y desaparece segun hay o no
// seleccion, y si moviera el contenido la fila que se acaba de marcar se iria de
// sitio bajo el cursor.

import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@hyperloopupv/frontend-kit/components";
import { useState } from "react";
import type { Log } from "../../api/types";
import { csvFilename, downloadCsv } from "./exportCsv";
import { TagEditor } from "./TagEditor";
import { describeResult } from "./useBulkTags";
import type { BulkResult } from "./useBulkTags";

interface BulkBarProps {
  selectedLogs: Log[];
  suggestions: string[];
  running: boolean;
  result: BulkResult | null;
  onApply: (mode: "add" | "remove", tags: string[]) => void;
  onClear: () => void;
}

export function BulkBar({
  selectedLogs,
  suggestions,
  running,
  result,
  onApply,
  onClear,
}: BulkBarProps) {
  const [draft, setDraft] = useState<string[]>([]);

  const run = (mode: "add" | "remove") => {
    if (draft.length === 0) return;
    onApply(mode, draft);
    setDraft([]);
  };

  // Al quitar tags solo tiene sentido sugerir los que la seleccion lleva puestos.
  const inSelection = [
    ...new Set(selectedLogs.flatMap((log) => log.tags)),
  ].sort();

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-4">
      <div className="bg-popover text-popover-foreground pointer-events-auto flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 shadow-lg">
        <span className="text-xs font-medium tabular-nums">
          {selectedLogs.length} selected
        </span>

        <span className="bg-border h-4 w-px" aria-hidden />

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={running}
            >
              {running ? "Working…" : "Edit tags"}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="center" side="top" className="w-72">
            <div className="flex flex-col gap-2">
              <span className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
                Tags
              </span>
              <TagEditor
                value={draft}
                onChange={setDraft}
                suggestions={[...new Set([...suggestions, ...inSelection])]}
                placeholder="Type a tag…"
              />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  disabled={draft.length === 0 || running}
                  onClick={() => run("add")}
                >
                  Add to {selectedLogs.length}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={draft.length === 0 || running}
                  onClick={() => run("remove")}
                >
                  Remove
                </Button>
              </div>
              <p className="text-muted-foreground text-[10px]">
                You can only edit logs you uploaded, unless you are an
                administrator. The rest are skipped and counted.
              </p>
            </div>
          </PopoverContent>
        </Popover>

        <button
          type="button"
          onClick={() =>
            downloadCsv(selectedLogs, csvFilename("cloud-logs-selection"))
          }
          className="text-muted-foreground hover:text-foreground text-[11px] underline underline-offset-2"
        >
          CSV
        </button>

        {result && (
          <span className="text-muted-foreground text-[11px]">
            {describeResult(result)}
          </span>
        )}

        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          className="text-muted-foreground hover:text-foreground ml-1 leading-none"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
