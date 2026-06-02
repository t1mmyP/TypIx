import { getCurrentWindow } from "@tauri-apps/api/window";
import Correction from "./Correction";
import Settings from "./Settings";

// Both windows load the same bundle; route by the window label.
export default function App() {
  const label = getCurrentWindow().label;
  return label === "settings" ? <Settings /> : <Correction />;
}
