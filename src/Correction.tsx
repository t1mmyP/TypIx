import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { invoke } from "@tauri-apps/api/core";
import { correctText } from "./lib/correct";
import { computeDiff, type DiffPart } from "./lib/diff";
import { Diff } from "./components/Diff";

type Status = "idle" | "streaming" | "done" | "error";

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
  const correctedRef         = useRef("");
  const originalRef          = useRef("");   // original text for live diff
  const streamedRef          = useRef("");   // accumulated stream so far
  const bodyRef              = useRef<HTMLDivElement>(null);

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
          // Nur nach einem vollständigen Wort (Leerzeichen im Token) neu diffen.
          // Dabei nur die bereits verarbeiteten Wörter des Originals vergleichen —
          // verhindert das rote Chaos durch noch nicht verarbeiteten Originaltext.
          if (/\s/.test(token)) {
            const partial = processedOriginal(originalRef.current, streamedRef.current);
            setDiff(computeDiff(partial, streamedRef.current));
          }
        });
        correctedRef.current = corrected;
        // Final diff from the authoritative return value.
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
      if (e.key === "Enter" && status === "done") {
        e.preventDefault();
        if (e.shiftKey) {
          // Nur in Zwischenablage kopieren, nicht einfügen.
          writeText(correctedRef.current).finally(() => getCurrentWindow().hide());
        } else {
          // Korrigierten Text direkt in die Quelle einfügen.
          invoke("accept_correction", { text: correctedRef.current });
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        getCurrentWindow().hide();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status]);

  const isIdle      = status === "idle";
  const isStreaming = status === "streaming";
  const isDone      = status === "done";
  const isError     = status === "error";
  const isActive    = isStreaming || isDone;

  const panelWidth = isIdle ? 360 : lots ? 560 : 520;

  return (
    <div className="d4-wrap">
      <div className="d4" style={{ width: panelWidth }}>

        {/* ── Idle: zentrierte Dots ── */}
        {isIdle && (
          <div className="d4-idle">
            <span className="dots d4-dots"><i /><i /><i /></span>
            <p>TypIx korrigiert deinen Text…</p>
            <span className="modelchip"><span className="led" />{model}</span>
          </div>
        )}

        {/* ── Active (Streaming + Done): Header bleibt, Body + Footer wechseln ──
            key="active" → dieses div mountet neu wenn wir von idle kommen → Bloom-Animation.
            Zwischen streaming↔done bleibt es gemountet → kein erneuter Bloom. ── */}
        {isActive && (
          <div key="active" className="d4-active">
            <div className="d4-head">
              <div className="d4-brand"><span className="d4-logo" />TypIx</div>
              <span className="modelchip"><span className="led" />{model}</span>
            </div>

            {/* Body: Diff wird live während des Streamens aktualisiert */}
            <div
              ref={bodyRef}
              className={`d4-body${lots ? " scrolls" : ""}`}
              style={lots ? { maxHeight: 250 } : undefined}
            >
              <p className="d4-text">
                <Diff parts={diff} />
                {isStreaming && <span className="d4-cursor" />}
              </p>
            </div>

            {/* Footer: Dots während Stream, Keyboard-Hints wenn fertig */}
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
    </div>
  );
}
