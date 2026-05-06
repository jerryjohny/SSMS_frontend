import { useState } from "react";

import Auth from "./components/Auth";
import Layout from "./components/Layout";
import { useAuth } from "./authContext";
import { I18nProvider } from "./i18nContext";
import { useI18n } from "./i18nContext";
import HomePage from "./pages/HomePage";
import CatalogPage from "./pages/CatalogPage";
import PendingPage from "./pages/PendingPage";
import { AuthProvider } from "./authContext";
import { PageKey } from "./utils/types";
import "./App.css";

function renderPage(page: PageKey) {
  switch (page) {
    case "pending":
      return <PendingPage />;
    case "catalog":
      return <CatalogPage />;
    case "home":
    default:
      return <HomePage />;
  }
}

function AppShell() {
  const [activePage, setActivePage] = useState<PageKey>("home");
  const { isAuthenticated, isReady } = useAuth();
  const { copy } = useI18n();

  if (!isReady) {
    return (
      <div className="page-stack">
        <section className="surface-panel compact-hero">
          <p className="eyebrow">SSMS</p>
          <h2>{copy.common.loadingWorkspace}</h2>
        </section>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Auth />;
  }

  return (
    <Layout activePage={activePage} onChangePage={setActivePage}>
      {renderPage(activePage)}
    </Layout>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </I18nProvider>
  );
}
