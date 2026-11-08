// Hoja de atajos de teclado.
//
// competition-view y logging-view tienen la suya, asi que es patron de la casa. Una
// herramienta interna que se usa a diario se recorre con el teclado; si los atajos no
// estan escritos en ninguna parte, no existen.

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@hyperloopupv/frontend-kit/components";

interface Shortcut {
  keys: string[];
  action: string;
}

const GROUPS: { title: string; shortcuts: Shortcut[] }[] = [
  {
    title: "Anywhere",
    shortcuts: [
      { keys: ["?"], action: "Show this list" },
      { keys: ["Ctrl", "B"], action: "Collapse or expand the sidebar" },
    ],
  },
  {
    title: "Catalog",
    shortcuts: [
      { keys: ["/"], action: "Jump to the search box" },
      { keys: ["↑", "↓"], action: "Move between rows" },
      { keys: ["Enter"], action: "Open the selected log" },
      { keys: ["Esc"], action: "Close the detail panel" },
    ],
  },
];

function Key({ children }: { children: string }) {
  return (
    <kbd className="border-border bg-muted text-muted-foreground inline-flex h-5 min-w-5 items-center justify-center rounded border px-1.5 font-mono text-[10px] font-medium">
      {children}
    </kbd>
  );
}

export function KeyboardShortcutsHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[22rem] gap-0">
        <SheetHeader>
          <SheetTitle>Keyboard shortcuts</SheetTitle>
          <SheetDescription>
            Everything here works without reaching for the mouse.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-4">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <p className="text-muted-foreground mb-2 text-[10px] font-semibold tracking-wider uppercase">
                {group.title}
              </p>
              <ul className="flex flex-col gap-1.5">
                {group.shortcuts.map((shortcut) => (
                  <li
                    key={shortcut.action}
                    className="flex items-center justify-between gap-3 text-xs"
                  >
                    <span className="text-muted-foreground">
                      {shortcut.action}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {shortcut.keys.map((key) => (
                        <Key key={key}>{key}</Key>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
