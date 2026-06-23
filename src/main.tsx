import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { useProjectStore } from "@/stores/project-store";

// Load recents and re-open the last project before first paint. (No StrictMode:
// its dev-only double-invoke would fire every AI/PDF effect twice.)
void useProjectStore.getState().init();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
