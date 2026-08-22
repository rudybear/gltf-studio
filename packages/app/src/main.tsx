import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "@xyflow/react/dist/style.css";
import "@gltf-studio/graph-canvas/graph-canvas.css";
import "@gltf-studio/audio-canvas/audio-canvas.css";
import "@gltf-studio/script-panel/script-panel.css";
import "@gltf-studio/audio-script-panel/audio-script-panel.css";
import "./styles/app.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root element not found.");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
