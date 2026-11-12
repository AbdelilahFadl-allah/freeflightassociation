import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./style.css";

// StrictMode exposes unsafe effect setup and cleanup during development.
createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
