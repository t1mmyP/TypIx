import { diffWords } from "diff";

/** One segment of a word-level diff between original and corrected text. */
export interface DiffPart {
  value: string;
  added?: boolean;
  removed?: boolean;
}

/**
 * Word-level diff. The model returns only the corrected text; the diff is
 * computed client-side (more robust than asking a 3B model to mark changes).
 */
export function computeDiff(original: string, corrected: string): DiffPart[] {
  return diffWords(original, corrected) as DiffPart[];
}
