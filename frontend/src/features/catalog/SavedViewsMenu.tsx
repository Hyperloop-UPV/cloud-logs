// Menu de busquedas guardadas, en la cabecera del catalogo.

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
} from "@hyperloopupv/frontend-kit/components";
import { ChevronDown } from "@hyperloopupv/frontend-kit/icons";
import { Bookmark } from "lucide-react";
import { useState } from "react";
import type { SavedView } from "./useSavedViews";

interface SavedViewsMenuProps {
  views: SavedView[];
  /** Query string actual, la que se guardaria. */
  currentQuery: string;
  hasFilters: boolean;
  onApply: (query: string) => void;
  onSave: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}

export function SavedViewsMenu({
  views,
  currentQuery,
  hasFilters,
  onApply,
  onSave,
  onRename,
  onRemove,
}: SavedViewsMenuProps) {
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState("");

  const commit = () => {
    if (!draft.trim()) return;
    onSave(draft);
    setDraft("");
    setNaming(false);
  };

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) {
          setNaming(false);
          setDraft("");
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs">
          <Bookmark className="size-3.5" />
          Views
          {views.length > 0 && (
            <span className="text-muted-foreground tabular-nums">
              {views.length}
            </span>
          )}
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-[10px] font-semibold tracking-wider uppercase">
          Saved searches
        </DropdownMenuLabel>

        {views.length === 0 ? (
          <p className="text-muted-foreground px-2 py-1.5 text-[11px]">
            None yet. Filter the catalog, then save it here.
          </p>
        ) : (
          views.map((view) => (
            <DropdownMenuItem
              key={view.id}
              onSelect={() => onApply(view.query)}
              className="group/view flex items-center gap-2 text-xs"
            >
              <span className="min-w-0 flex-1 truncate">{view.name}</span>
              <button
                type="button"
                aria-label={`Rename ${view.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  event.preventDefault();
                  const next = window.prompt("Rename this view", view.name);
                  if (next) onRename(view.id, next);
                }}
                className="text-muted-foreground hover:text-foreground shrink-0 text-[10px] underline underline-offset-2 opacity-0 transition-opacity group-hover/view:opacity-100"
              >
                rename
              </button>
              <button
                type="button"
                aria-label={`Delete ${view.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  event.preventDefault();
                  onRemove(view.id);
                }}
                className="text-muted-foreground hover:text-destructive shrink-0 leading-none opacity-0 transition-opacity group-hover/view:opacity-100"
              >
                ✕
              </button>
            </DropdownMenuItem>
          ))
        )}

        <DropdownMenuSeparator />

        {naming ? (
          <div className="flex items-center gap-1 px-2 py-1.5">
            <Input
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commit();
                }
                if (event.key === "Escape") setNaming(false);
              }}
              placeholder="Name this view"
              className="h-7 text-xs shadow-none"
            />
            <Button size="sm" className="h-7 text-xs" onClick={commit}>
              Save
            </Button>
          </div>
        ) : (
          <DropdownMenuItem
            disabled={!hasFilters && !currentQuery}
            onSelect={(event) => {
              event.preventDefault();
              setNaming(true);
            }}
            className="text-xs"
          >
            Save current search…
          </DropdownMenuItem>
        )}

        <p className="text-muted-foreground px-2 pt-1 pb-1.5 text-[10px]">
          Stored in this browser, not in your account.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
