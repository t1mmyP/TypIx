import type { DiffPart } from "../lib/diff";

/** Renders a word-level diff as inline spans (added / removed / unchanged). */
export function Diff({ parts }: { parts: DiffPart[] }) {
  return (
    <div className="diff">
      {parts.map((part, i) => {
        const cls = part.added ? "added" : part.removed ? "removed" : "unchanged";
        return (
          <span key={i} className={cls}>
            {part.value}
          </span>
        );
      })}
    </div>
  );
}
