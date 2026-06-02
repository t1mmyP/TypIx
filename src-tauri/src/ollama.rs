use crate::settings::AppState;
use futures_util::StreamExt;
use serde::Deserialize;
use std::net::TcpStream;
use std::time::Duration;
use tauri::ipc::Channel;

const OLLAMA_URL: &str = "http://127.0.0.1:11434";
const SYSTEM_PROMPT: &str = "Du bist ein präzises Korrekturwerkzeug für Texte. \
Korrigiere ausschließlich Rechtschreibung, Grammatik und Zeichensetzung des folgenden Textes. \
Bewahre Bedeutung, Tonfall, Sprache und Formatierung exakt. Erfinde keine Inhalte und kürze nichts. \
Gib AUSSCHLIESSLICH den korrigierten Text aus – ohne Erklärungen, ohne Anführungszeichen, ohne Einleitung.";

#[derive(Deserialize)]
struct GenerateChunk {
    #[serde(default)]
    response: String,
    #[serde(default)]
    done: bool,
}

/// Streams a correction from the local Ollama server. Each token is forwarded
/// to the frontend over `on_chunk`; the full corrected text is returned at the end.
#[tauri::command]
pub async fn correct_text(
    text: String,
    on_chunk: Channel<String>,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    // Read the configured model, then drop the lock before any await point.
    let model = state.settings.lock().unwrap().model.clone();

    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "model": model,
        "system": SYSTEM_PROMPT,
        "prompt": text,
        "stream": true,
        "keep_alive": "5m",
        "options": { "temperature": 0.2 }
    });

    let resp = client
        .post(format!("{OLLAMA_URL}/api/generate"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama nicht erreichbar: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Ollama-Fehler: HTTP {}", resp.status()));
    }

    let mut stream = resp.bytes_stream();
    let mut full = String::new();
    // Ollama streams newline-delimited JSON; buffer partial lines across chunks.
    let mut buf = String::new();

    while let Some(item) = stream.next().await {
        let bytes = item.map_err(|e| e.to_string())?;
        buf.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(idx) = buf.find('\n') {
            let line: String = buf.drain(..=idx).collect();
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if let Ok(chunk) = serde_json::from_str::<GenerateChunk>(line) {
                if !chunk.response.is_empty() {
                    full.push_str(&chunk.response);
                    let _ = on_chunk.send(chunk.response);
                }
                if chunk.done {
                    return Ok(full);
                }
            }
        }
    }

    Ok(full)
}

/// If nothing is listening on the Ollama port, spawn `ollama serve` in the
/// background. Harmless no-op if a server (or the desktop app) is already up.
pub fn ensure_server() {
    if let Ok(addr) = "127.0.0.1:11434".parse() {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok() {
            return;
        }
    }
    let _ = std::process::Command::new("ollama").arg("serve").spawn();
}
