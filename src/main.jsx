import React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "./styles.css";
import "./catalog-pages.css";
import "./account.css";
import "./editorial.css";
import "./locale.css";
import "./page-connections.css";
import "./collections.css";
import "./navigation.css";

const app = (
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
const root = document.getElementById("root");
if (root.hasChildNodes()) hydrateRoot(root, app);
else createRoot(root).render(app);
