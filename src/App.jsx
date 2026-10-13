import { Component, lazy, Suspense, useEffect } from "react";
import AdminNotifications from "./components/AdminNotifications";
import AdminPushNotifications from "./components/AdminPushNotifications";
import AdminAccess from "./components/AdminAccess";
import MobileSection from "./components/MobileSection";
import LogoutButton from "./components/LogoutButton";
import LoginPage from "./pages/LoginPage";
import "./styles/admin.css";

const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const BookingsPage = lazy(() => import("./pages/BookingsPage"));
const ActivityPage = lazy(() => import("./pages/ActivityPage"));
const PasswordResetPage = lazy(() => import("./pages/PasswordResetPage"));
const MaintenanceSettingsPage = lazy(() => import("./pages/MaintenanceSettingsPage"));

const routes = {
  "/attivita": { title: "Attività", Page: ActivityPage, restricted: true },
  "/": { title: "Accesso", Page: LoginPage, restricted: false },
  "/reimposta-password": { title: "Reimposta password", Page: PasswordResetPage, restricted: false },
  "/prenotazioni": { title: "Calendario", Page: CalendarPage, restricted: true },
  "/prenotazioni/giorno": { title: "Giornata", Page: BookingsPage, restricted: true },
  "/manutenzione": { title: "Manutenzione sito", Page: MaintenanceSettingsPage, restricted: true },
};

class ErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="booking-admin">
      <p role="alert">Qualcosa è andato storto.</p>
      <button className="admin-button" type="button" onClick={() => window.location.reload()}>Ricarica</button>
    </main>;
  }
}

function NotFound() {
  return <main className="booking-admin">
    <h1>Pagina non trovata</h1>
    <a href="/prenotazioni">← Vai all’agenda</a>
  </main>;
}

export default function App() {
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  const route = routes[path];
  const restricted = Boolean(route?.restricted);

  useEffect(() => {
    document.title = `${route ? route.title : "Non trovata"} · Agenda Makai`;
  }, [route]);

  let page = <NotFound />;
  if (route) {
    const { Page } = route;
    page = restricted ? <AdminAccess><AdminPushNotifications /><AdminNotifications /><Page /></AdminAccess> : <Page />;
  }

  return <div className={`admin-shell${restricted ? " admin-shell-private" : ""}`}>
    <header className="admin-header">
      <a href={restricted ? "/prenotazioni" : "/"} className="admin-brand">Makai <span>Agenda</span></a>
      {restricted && <MobileSection title="Menu" className="mobile-header-menu"><div className="admin-header-actions">
        <a href="/prenotazioni" aria-current={path.startsWith("/prenotazioni") ? "page" : undefined}>Agenda</a>
        <a href="/attivita" aria-current={path === "/attivita" ? "page" : undefined}>Attività</a>
        <a href="/manutenzione" aria-current={path === "/manutenzione" ? "page" : undefined}>Manutenzione sito</a>
        <span className="admin-area-label">Area riservata</span>
        <LogoutButton />
      </div></MobileSection>}
    </header>
    <ErrorBoundary>
      <Suspense fallback={<main className="booking-admin"><p aria-live="polite">Caricamento…</p></main>}>
        {page}
      </Suspense>
    </ErrorBoundary>
  </div>;
}
