import type { DiffPart } from "../lib/diff";

interface DiffProps {
  parts: DiffPart[];
  /**
   * During streaming, deletions are suppressed: the LLM hasn't finished yet,
   * so showing "removed" spans would make unprocessed original text appear
   * as red strikethrough. Deletions are revealed once the stream is done.
   */
  streaming?: boolean;
  onWordContextMenu?: (word: string, x: number, y: number) => void;
}

/** Strips leading/trailing punctuation, keeping letters/digits/umlauts. */
function extractWord(raw: string): string {
  return raw.trim().replace(/^[^\wäöüÄÖÜß]+|[^\wäöüÄÖÜß]+$/g, "");
}

/** Renders a word-level diff as inline spans using design tokens. */
export function Diff({ parts, streaming = false, onWordContextMenu }: DiffProps) {
  function handleContextMenu(e: React.MouseEvent, rawValue: string) {
    if (!onWordContextMenu) return;
    e.preventDefault();
    e.stopPropagation();
    // Prefer the current text selection (allows multi-word or custom aliases);
    // fall back to the word extracted from the clicked span.
    const selection = window.getSelection()?.toString().trim() ?? "";
    const word = selection || extractWord(rawValue);
    if (word) onWordContextMenu(word, e.clientX, e.clientY);
  }

  return (
    <span className="diff">
      {parts.map((part, i) => {
        if (part.removed) {
          if (streaming) return null;
          return (
            <span
              key={i}
              className="diff-del"
              onContextMenu={(e) => handleContextMenu(e, part.value)}
            >
              {part.value}
            </span>
          );
        }
        if (part.added) {
          return (
            <span
              key={i}
              className="diff-ins"
              onContextMenu={(e) => handleContextMenu(e, part.value)}
            >
              {part.value}
            </span>
          );
        }
        return (
          <span
            key={i}
            onContextMenu={(e) => handleContextMenu(e, part.value)}
          >
            {part.value}
          </span>
        );
      })}
    </span>
  );
}
