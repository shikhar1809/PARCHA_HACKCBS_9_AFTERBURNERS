import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { ErrorBoundary } from "@parcha/client";
import { App } from "./App";
import { AuthProvider } from "./auth";
import "@parcha/ui/styles.css";
import "@parcha/ui/theme.css";
import "./clinic.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
