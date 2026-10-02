import { useEffect, useState } from "react";

export default function AdminAccess({ children }) {
  const [status, setStatus] = useState("checking");
  useEffect(() => {
    let controller;
    async function verify() {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      setStatus("checking");
      try {
        const response = await fetch("/api/admin/session", { credentials: "same-origin", cache: "no-store", signal });
        if (signal.aborted) return;
        if (response.status === 401) {
          window.location.replace("/");
          return;
        }
        setStatus(response.ok ? "ready" : "error");
      } catch (error) {
        if (error.name !== "AbortError") setStatus("error");
      }
    }
    function onVisible() { if (document.visibilityState === "visible") verify(); }
    verify();
    window.addEventListener("pageshow", verify);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller?.abort();
      window.removeEventListener("pageshow", verify);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  if (status === "ready") return children;
  return <main className="booking-admin">
    <h1>Area gestore</h1>
    {status === "checking" ? <p role="status">Verifica dell’accesso…</p> : <>
      <p role="alert">Non riesco a verificare l’accesso. Controlla che il backend sia avviato e configurato.</p>
      <a href="/">Torna al login</a>
    </>}
  </main>;
}
