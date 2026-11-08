// Tags mas usados, como nube de chips proporcionales.
//
// El tamano del contador comunica el peso sin necesidad de una grafica. Cada chip
// filtra el catalogo por ese tag.

import { Link } from "react-router-dom";
import type { TagCount } from "../../api/types";
import { formatCount } from "../../lib/format";

export function TopTags({ tags }: { tags: TagCount[] }) {
  if (tags.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-xs">
        No tags in use.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <Link
          key={tag.tag}
          to={`/catalog?tags=${encodeURIComponent(tag.tag)}`}
          className="border-border text-muted-foreground hover:border-primary/40 hover:text-foreground inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-colors"
        >
          {tag.tag}
          <span className="tabular-nums opacity-60">
            {formatCount(tag.count)}
          </span>
        </Link>
      ))}
    </div>
  );
}
