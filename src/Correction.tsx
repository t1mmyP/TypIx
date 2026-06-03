import { useEffect, useRef, useState } from "react";
import typixIcon from "./assets/typix-icon.svg";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { invoke } from "@tauri-apps/api/core";
import { correctText } from "./lib/correct";
import { computeDiff, type DiffPart } from "./lib/diff";
import { Diff } from "./components/Diff";

type Status = "idle" | "streaming" | "done" | "error";

interface CtxMenu { x: number; y: number; word: string }

/**
 * Liefert nur die ersten N Wörter eines Textes (N = Wortanzahl in `streamed`).
 * Dadurch vergleichen wir beim Live-Diff immer nur den bereits verarbeiteten
 * Anteil des Originals — der Rest taucht gar nicht erst im Diff auf.
 */
function processedOriginal(original: string, streamed: string): string {
  const n = (streamed.match(/\S+/g) ?? []).length;
  const words = original.match(/\S+\s*/g) ?? [];
  return words.slice(0, n).join("");
}

export default function Correction() {
  const [status, setStatus]  = useState<Status>("idle");
  const [diff, setDiff]      = useState<DiffPart[]>([]);
  const [error, setError]    = useState("");
  const [model, setModel]    = useState("…");
  const [lots, setLots]      = useState(false);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [ctxInput, setCtxInput] = useState("");
  const [ctxStatus, setCtxStatus] = useState<"idle" | "saved">("idle");
  const correctedRef          = useRef("");
  const originalRef           = useRef("");
  const streamedRef           = useRef("");
  const bodyRef               = useRef<HTMLDivElement>(null);
  const ctxInputRef           = useRef<HTMLInputElement>(null);

  // Fetch active model name for the chip.
  useEffect(() => {
    invoke<{ selected_model: string }>("get_settings")
      .then((s) => setModel(s.selected_model))
      .catch(() => {});
  }, []);

  // Während des Streamens immer ans Ende scrollen.
  useEffect(() => {
    if (status !== "streaming") return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  // Measure body → switch to scroll ("lots") once height > 250px.
  useEffect(() => {
    if (status === "idle") { setLots(false); return; }
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLots(el.scrollHeight > 250));
    ro.observe(el);
    setLots(el.scrollHeight > 250);
    return () => ro.disconnect();
  }, [status, diff]);

  // Listen for correction requests from Rust.
  useEffect(() => {
    let disposed = false;
    const unlisten = listen<string>("correct-request", async (event) => {
      if (disposed) return;
      const text = event.payload ?? "";

      setDiff([]);
      setError("");
      setCtxMenu(null);
      correctedRef.current = "";
      originalRef.current  = text;
      streamedRef.current  = "";

      if (!text.trim()) {
        setStatus("idle");
        return;
      }

      setStatus("streaming");
      try {
        const corrected = await correctText(text, (token) => {
          streamedRef.current += token;
          if (/\s/.test(token)) {
            const partial = processedOriginal(originalRef.current, streamedRef.current);
            setDiff(computeDiff(partial, streamedRef.current));
          }
        });
        correctedRef.current = corrected;
        setDiff(computeDiff(text, corrected));
        setStatus("done");
      } catch (e) {
        setError(String(e));
        setStatus("error");
      }
    });
    return () => { disposed = true; unlisten.then((f) => f()); };
  }, []);

  // Tastatur: Enter = ersetzen, Shift+Enter = nur kopieren, Esc = abbrechen.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (ctxMenu) return; // context menu handles its own keys
      if (e.key === "Enter" && status === "done") {
        e.preventDefault();
        if (e.shiftKey) {
          writeText(correctedRef.current).finally(() => getCurrentWindow().hide());
        } else {
          invoke("accept_correction", { text: correctedRef.current });
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        getCurrentWindow().hide();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status, ctxMenu]);

  // Close context menu on outside click.
  useEffect(() => {
    if (!ctxMenu) return;
    function onMouseDown(e: MouseEvent) {
      const menu = document.querySelector(".ctx-menu");
      if (menu && !menu.contains(e.target as Node)) setCtxMenu(null);
    }
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [ctxMenu]);

  // Focus input when context menu opens.
  useEffect(() => {
    if (ctxMenu) {
      setCtxStatus("idle");
      ctxInputRef.current?.focus();
      ctxInputRef.current?.select();
    }
  }, [ctxMenu]);

  function openCtxMenu(word: string, x: number, y: number) {
    setCtxInput(word);
    setCtxMenu({ x, y, word });
  }

  async function addToWhitelist() {
    const word = ctxInput.trim();
    if (!word) return;
    try {
      const s = await invoke<{ whitelist: string[] } & Record<string, unknown>>("get_settings");
      if (!s.whitelist.includes(word)) {
        await invoke("set_settings", {
          settings: { ...s, whitelist: [...s.whitelist, word] },
        });
      }
      setCtxStatus("saved");
      setTimeout(() => setCtxMenu(null), 700);
    } catch {
      setCtxMenu(null);
    }
  }

  const isIdle      = status === "idle";
  const isStreaming = status === "streaming";
  const isDone      = status === "done";
  const isError     = status === "error";
  const isActive    = isStreaming || isDone;

  const panelWidth = isIdle ? 360 : lots ? 560 : 520;

  return (
    <div
      className="d4-wrap"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="d4" style={{ width: panelWidth }}>

        {/* ── Idle ── */}
        {isIdle && (
          <div className="d4-idle">
            <p>Text auswählen, dann Shortcut drücken.</p>
            <span className="modelchip"><span className="led" />{model}</span>
          </div>
        )}

        {/* ── Active (Streaming + Done) ── */}
        {isActive && (
          <div key="active" className="d4-active">
            <div className="d4-head">
              <div className="d4-brand"><img src={typixIcon} className="d4-logo" alt="" />TypIx</div>
              <span className="modelchip"><span className="led" />{model}</span>
            </div>

            <div
              ref={bodyRef}
              className={`d4-body${lots ? " scrolls" : ""}`}
              style={lots ? { maxHeight: 250 } : undefined}
            >
              <p className="d4-text">
                <Diff
                  parts={diff}
                  onWordContextMenu={isDone ? openCtxMenu : undefined}
                />
                {isStreaming && <span className="d4-cursor" />}
              </p>
            </div>

            <div className="d4-foot">
              {isStreaming ? (
                <span className="dots d4-dots-sm"><i /><i /><i /></span>
              ) : (
                <>
                  <span className="kbd">↵</span>
                  <span>ersetzen</span>
                  <span className="d4-sep">·</span>
                  <span className="kbd">⇧↵</span>
                  <span>kopieren</span>
                  <span className="d4-sep">·</span>
                  <span className="kbd">esc</span>
                  <span>abbrechen</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Error ── */}
        {isError && (
          <div className="d4-error">{error}</div>
        )}

      </div>

      {/* ── Context Menu ── */}
      {ctxMenu && (
        <div
          className="ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          {ctxStatus === "saved" ? (
            <div className="ctx-menu-saved">✓ Gespeichert</div>
          ) : (
            <>
              <div className="ctx-menu-label">Zur Whitelist hinzufügen</div>
              <div className="ctx-menu-row">
                <input
                  ref={ctxInputRef}
                  className="ctx-menu-input"
                  value={ctxInput}
                  spellCheck={false}
                  onChange={(e) => setCtxInput(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") addToWhitelist();
                    if (e.key === "Escape") setCtxMenu(null);
                  }}
                />
                <button className="ctx-menu-btn" onClick={addToWhitelist}>
                  +
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
