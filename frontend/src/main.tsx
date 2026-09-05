import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import type { PageKey } from "./ReportPages";
import "./styles.css";
import "./design.css";

const rootElement = document.getElementById("root");
const dataPage = rootElement?.getAttribute("data-page") as PageKey | null;

function getInitialPage(): PageKey {
  if (dataPage) return dataPage;
  const path = window.location.pathname.toLowerCase();
  if (path.includes("portfolio")) return "portfolio";
  if (path.includes("risk")) return "risk";
  if (path.includes("optimize")) return "optimize";
  if (path.includes("simulation")) return "simulation";
  if (path.includes("rebalance")) return "rebalance";
  return "home";
}

createRoot(rootElement!).render(
  <React.StrictMode>
    <App initialPage={getInitialPage()} />
  </React.StrictMode>,
);
