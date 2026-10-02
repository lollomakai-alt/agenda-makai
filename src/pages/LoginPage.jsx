import { useState } from "react";

export default function LoginPage() {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function login(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Admin-Request": "1" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        const messages = {
          401: "Nome utente o password non corretti.",
          429: "Troppi tentativi. Riprova tra un minuto.",
          503: "Accesso amministratore non configurato sul backend.",
        };
        throw new Error(messages[response.status] || "Accesso non disponibile. Controlla che il backend sia avviato.");
      }
      setPassword("");
      window.location.replace("/prenotazioni");
    } catch (failure) {
      setPassword("");
      setError(failure.message || "Connessione non disponibile.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="booking-admin booking-login">
    <h1>Area gestore</h1>
    <p>Accedi per consultare le prenotazioni del Makai.</p>
    <form onSubmit={login} className="booking-admin-form">
      <label>Nome utente
        <input name="username" autoComplete="username" required maxLength={100}
          value={username} onChange={(event) => setUsername(event.target.value)} />
      </label>
      <label>Password
        <input name="password" type="password" autoComplete="current-password" required maxLength={1000}
          value={password} onChange={(event) => setPassword(event.target.value)} />
      </label>
      <button type="submit" disabled={busy}>{busy ? "Accesso in corso…" : "Accedi"}</button>
    </form>
    {error && <p role="alert">{error}</p>}
  </main>;
}
