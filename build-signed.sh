#!/bin/bash
set -e

if [ ! -f ".env.build" ]; then
  echo "Fehler: .env.build nicht gefunden."
  echo "Kopiere .env.build.example zu .env.build und trage dein App-Passwort ein."
  exit 1
fi

set -a
source .env.build
set +a

source "$HOME/.cargo/env"

npm run tauri build
