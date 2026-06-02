import type { DiffPart } from "../lib/diff";

interface DiffProps {
  parts: DiffPart[];
  /**
   * During streaming, deletions are suppressed: the LLM hasn't finished yet,
   * so showing "removed" spans would make unprocessed original text appear
   * as red strikethrough. Deletions are revealed once the stream is done.
   */
  streaming?: boolean;
}

/** Renders a word-level diff as inline spans using design tokens. */
export function Diff({ parts, streaming = false }: DiffProps) {
  return (
    <span className="diff">
      {parts.map((part, i) => {
        if (part.removed) {
          if (streaming) return null;
          return <span key={i} className="diff-del">{part.value}</span>;
        }
        if (part.added) return <span key={i} className="diff-ins">{part.value}</span>;
        return <span key={i}>{part.value}</span>;
      })}
    </span>
  );
}
