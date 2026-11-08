// Editor y selector de tags: chips con quitar, mas un campo con sugerencias.
//
// Se escribe a mano en vez de usar el Combobox del kit porque hacen falta las dos
// cosas a la vez: elegir de los tags que ya existen (en el filtro del catalogo) y
// escribir uno nuevo (al etiquetar un log que estrena categoria). El modelo de
// seleccion de un combobox cubre lo primero pero no lo segundo.
//
// Con `allowCreate` en false se comporta como un selector puro: lo que se teclea
// solo filtra la lista y nunca crea nada.

import { cn } from "@hyperloopupv/frontend-kit/lib";
import { useEffect, useId, useMemo, useRef, useState } from "react";

interface TagEditorProps {
  value: string[];
  onChange: (next: string[]) => void;
  /** Tags que ya existen en el catalogo, para sugerir. */
  suggestions?: string[];
  allowCreate?: boolean;
  placeholder?: string;
  className?: string;
}

/** Los tags se guardan normalizados para que "Pod" y "pod" no sean dos categorias. */
function normalise(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-");
}

export function TagEditor({
  value,
  onChange,
  suggestions = [],
  allowCreate = true,
  placeholder = "Add a tag…",
  className,
}: TagEditorProps) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const container = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  const matches = useMemo(() => {
    const needle = normalise(text);
    return suggestions
      .filter((tag) => !value.includes(tag))
      .filter((tag) => !needle || tag.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [suggestions, value, text]);

  // El indice resaltado se recorta cuando la lista se acorta al teclear.
  const safeHighlight = Math.min(highlighted, Math.max(0, matches.length - 1));

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const add = (raw: string) => {
    const tag = normalise(raw);
    if (!tag || value.includes(tag)) {
      setText("");
      return;
    }
    if (!allowCreate && !suggestions.includes(tag)) return;
    onChange([...value, tag]);
    setText("");
    setHighlighted(0);
  };

  const remove = (tag: string) => onChange(value.filter((t) => t !== tag));

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      const picked = open && matches[safeHighlight];
      if (picked) add(picked);
      else if (allowCreate) add(text);
      return;
    }
    if (event.key === "Backspace" && text === "" && value.length > 0) {
      remove(value[value.length - 1]);
      return;
    }
    if (event.key === "ArrowDown" && matches.length > 0) {
      event.preventDefault();
      setOpen(true);
      setHighlighted((h) => (h + 1) % matches.length);
      return;
    }
    if (event.key === "ArrowUp" && matches.length > 0) {
      event.preventDefault();
      setOpen(true);
      setHighlighted((h) => (h - 1 + matches.length) % matches.length);
      return;
    }
    if (event.key === "Escape") setOpen(false);
  };

  return (
    <div ref={container} className={cn("relative", className)}>
      <div
        className={cn(
          "border-input focus-within:border-ring flex min-h-8 flex-wrap items-center gap-1 rounded-md border bg-transparent px-1.5 py-1",
          "dark:bg-input/30",
        )}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="bg-muted text-foreground inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium"
          >
            {tag}
            <button
              type="button"
              onClick={() => remove(tag)}
              aria-label={`Remove ${tag}`}
              className="text-muted-foreground hover:text-foreground leading-none"
            >
              ✕
            </button>
          </span>
        ))}

        <input
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
            setHighlighted(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={value.length === 0 ? placeholder : ""}
          aria-label="Tags"
          aria-expanded={open}
          aria-controls={open && matches.length > 0 ? listId : undefined}
          className="min-w-[6rem] flex-1 bg-transparent px-1 text-xs outline-none"
        />
      </div>

      {open && matches.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="bg-popover text-popover-foreground absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-md border p-1 shadow-md"
        >
          {matches.map((tag, index) => (
            <li key={tag}>
              <button
                type="button"
                role="option"
                aria-selected={index === safeHighlight}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => add(tag)}
                className={cn(
                  "w-full rounded px-2 py-1 text-left text-xs transition-colors",
                  index === safeHighlight && "bg-accent",
                )}
              >
                {tag}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
