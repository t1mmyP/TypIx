import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { correctText } from "./lib/correct";
import { computeDiff, type DiffPart } from "./lib/diff";
import { Diff } from "./components/Diff";

type Status = "idle" | "streaming" | "done" | "error";

export default function Correction() {
  const [status, setStatus] = useState<Status>("idle");
  const [streamed, setStreamed] = useState("");
  const [diff, setDiff] = useState<DiffPart[]>([]);
  const [error, setError] = useState("");
  // Authoritative corrected text used when the user accepts with Enter.
  const correctedRef = useRef("");

  // Listen for correction requests emitted from Rust (shortcut / tray).
  useEffect(() => {
    let disposed = false;
    const unlisten = listen<string>("correct-request", async (event) => {
      if (disposed) return;
      const text = event.payload ?? "";

      setStreamed("");
      setDiff([]);
      setError("");
      correctedRef.current = "";

      if (!text.trim()) {
        setStatus("idle");
        return;
      }

      setStatus("streaming");
      try {
        let acc = "";
        const corrected = await correctText(text, (token) => {
          acc += token;
          setStreamed(acc);
        });
        correctedRef.current = corrected;
        setStreamed(corrected);
        setDiff(computeDiff(text, corrected));
        setStatus("done");
      } catch (e) {
        setError(String(e));
        setStatus("error");
      }
    });

    return () => {
      disposed = true;
      unlisten.then((f) => f());
    };
  }, []);

  // Enter = accept (write corrected text to clipboard, hide). Esc = cancel (hide).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter" && status === "done") {
        e.preventDefault();
        const out = correctedRef.current;
        writeText(out).finally(() => getCurrentWindow().hide());
      } else if (e.key === "Escape") {
        e.preventDefault();
        getCurrentWindow().hide();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status]);

  return (
    <div className="app" data-status={status}>
      <header className="bar">
        <span className="title">TypIx</span>
        <span className="hint">
          {status === "idle" && "Text markieren, dann Shortcut drücken"}
          {status === "streaming" && "Korrigiere …"}
          {status === "done" && "Enter = übernehmen · Esc = abbrechen"}
          {status === "error" && "Fehler"}
        </span>
      </header>

      <main className="content">
        {status === "error" ? (
          <pre className="error">{error}</pre>
        ) : status === "done" ? (
          <Diff parts={diff} />
        ) : status === "streaming" ? (
          <div className="stream">
            {streamed}
            <span className="cursor" />
          </div>
        ) : (
          <div className="empty">
            <p>
              Kein markierter Text gefunden. Markiere Text und drücke{" "}
              <kbd>⌃⌥⇧⌘ S</kbd>.
            </p>
            <p className="muted">
              Falls nichts passiert: TypIx unter Systemeinstellungen →
              Datenschutz &amp; Sicherheit → <strong>Bedienungshilfen</strong>{" "}
              erlauben.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
