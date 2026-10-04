import { Component, lazy, Suspense, useEffect } from "react";
import AdminNotifications from "./components/AdminNotifications";
import AdminAccess from "./components/AdminAccess";
import LogoutButton from "./components/LogoutButton";
import LoginPage from "./pages/LoginPage";
import "./styles/admin.css";

const WaitlistPage = lazy(() => import("./pages/WaitlistPage"));
const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const BookingsPage = lazy(() => import("./pages/BookingsPage"));
const ActivityPage = lazy(() => import("./pages/ActivityPage"));
const PasswordResetPage = lazy(() => import("./pages/PasswordResetPage"));

const routes = {
  "/lista-attesa": { title: "Lista d’attesa", Page: WaitlistPage, restricted: true },
  "/attivita": { title: "Attività", Page: ActivityPage, restricted: true },
  "/": { title: "Accesso", Page: LoginPage, restricted: false },
  "/reimposta-password": { title: "Reimposta password", Page: PasswordResetPage, restricted: false },
  "/prenotazioni": { title: "Calendario", Page: CalendarPage, restricted: true },
  "/prenotazioni/giorno": { title: "Giornata", Page: BookingsPage, restricted: true },
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
    page = restricted ? <AdminAccess><AdminNotifications /><Page /></AdminAccess> : <Page />;
  }

  return <div className="admin-shell">
    <header className="admin-header">
      <a href={restricted ? "/prenotazioni" : "/"} className="admin-brand">Makai <span>Agenda</span></a>
      {restricted && <div className="admin-header-actions">
        <a href="/lista-attesa">Lista d’attesa</a>
        <a href="/attivita">Attività</a>
        <span className="admin-area-label">Area riservata</span>
        <LogoutButton />
      </div>}
    </header>
    <ErrorBoundary>
      <Suspense fallback={<main className="booking-admin"><p aria-live="polite">Caricamento…</p></main>}>
        {page}
      </Suspense>
    </ErrorBoundary>
  </div>;
}
