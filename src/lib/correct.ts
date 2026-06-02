import { invoke, Channel } from "@tauri-apps/api/core";

/**
 * Calls the Rust `correct_text` command. Tokens stream back over a Channel
 * (the HTTP call to Ollama lives in Rust to avoid webview CORS issues).
 * Resolves with the full corrected text once the stream ends.
 */
export async function correctText(
  text: string,
  onChunk: (token: string) => void
): Promise<string> {
  const channel = new Channel<string>();
  channel.onmessage = (token) => onChunk(token);
  return await invoke<string>("correct_text", { text, onChunk: channel });
}
