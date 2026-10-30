import { Component, lazy, Suspense, useEffect } from "react";
import AdminNotifications from "./components/AdminNotifications";
import AdminPushNotifications from "./components/AdminPushNotifications";
import AdminAccess from "./components/AdminAccess";
import MobileSection from "./components/MobileSection";
import LogoutButton from "./components/LogoutButton";
import AppearanceControl from "./components/AppearanceControl";
import AfterDinnerRequestsNavLink from "./components/AfterDinnerRequestsNavLink";
import CustomerRequestsNavLink from "./components/CustomerRequestsNavLink";
import useAgendaAppearance from "./hooks/useAgendaAppearance";
import LoginPage from "./pages/LoginPage";
import "./styles/admin.css";

const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const BookingsPage = lazy(() => import("./pages/BookingsPage"));
const ArchivePage = lazy(() => import("./pages/ArchivePage"));
const PasswordResetPage = lazy(() => import("./pages/PasswordResetPage"));
const MaintenanceSettingsPage = lazy(() => import("./pages/MaintenanceSettingsPage"));
const AfterDinnerRequestsPage = lazy(() => import("./pages/AfterDinnerRequestsPage"));
const CustomerRequestsPage = lazy(() => import("./pages/CustomerRequestsPage"));

const routes = {
  "/archivio": { title: "Archivio", Page: ArchivePage, restricted: true },
  "/attivita": { title: "Archivio", Page: ArchivePage, restricted: true },
  "/": { title: "Accesso", Page: LoginPage, restricted: false },
  "/reimposta-password": { title: "Reimposta password", Page: PasswordResetPage, restricted: false },
  "/prenotazioni": { title: "Calendario", Page: CalendarPage, restricted: true },
  "/prenotazioni/giorno": { title: "Giornata", Page: BookingsPage, restricted: true },
  "/manutenzione": { title: "Manutenzione sito", Page: MaintenanceSettingsPage, restricted: true },
  "/richieste-dopocena": { title: "Richieste DOPOCENA", Page: AfterDinnerRequestsPage, restricted: true },
  "/richieste-clienti": { title: "Richieste clienti", Page: CustomerRequestsPage, restricted: true },
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
  const { preference, changePreference } = useAgendaAppearance();
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  const route = routes[path];
  const restricted = Boolean(route?.restricted);

  useEffect(() => {
    document.title = `${route ? route.title : "Non trovata"} · Agenda Makai`;
  }, [route]);

  let page = <NotFound />;
  if (route) {
    const { Page } = route;
    page = <Page />;
  }

  const isDayRoute = path === "/prenotazioni/giorno";
  const hasBookingsHeader = path === "/prenotazioni" || isDayRoute;
  const header = <header className="admin-header">
    <div className="admin-brand-group">
      <a href={restricted ? "/prenotazioni" : "/"} className="admin-brand">Makai <span>Agenda</span></a>
      {restricted && <span className="admin-area-label">Area riservata</span>}
    </div>
    {restricted && <MobileSection title="Menu" className="mobile-header-menu"><div className="admin-header-actions">
      <a href="/prenotazioni" aria-current={path.startsWith("/prenotazioni") ? "page" : undefined}>Agenda</a>
      <a href="/archivio" aria-current={["/archivio", "/attivita"].includes(path) ? "page" : undefined}>Archivio</a>
      <a href="/manutenzione" aria-current={path === "/manutenzione" ? "page" : undefined}>Manutenzione sito</a>
      <AfterDinnerRequestsNavLink active={path === "/richieste-dopocena"} />
      <CustomerRequestsNavLink active={path === "/richieste-clienti"} />
      <AppearanceControl preference={preference} onChange={changePreference} />
      <LogoutButton />
    </div></MobileSection>}
    {restricted && <AdminNotifications />}
  </header>;
  const content = <ErrorBoundary>
    <Suspense fallback={<main className="booking-admin"><p aria-live="polite">Caricamento…</p></main>}>
      {page}
    </Suspense>
  </ErrorBoundary>;

  return <div className={`admin-shell${restricted ? " admin-shell-private" : ""}${hasBookingsHeader ? " admin-shell-bookings" : ""}${isDayRoute ? " admin-shell-day" : ""}`}>
    {restricted
      ? <AdminAccess>{header}<AdminPushNotifications />{content}</AdminAccess>
      : <>{header}{content}</>}
  </div>;
}
