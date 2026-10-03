import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

function recoveryLinkError() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  if (!params.has("error")) return "";
  if (params.get("error_code") === "otp_expired") return "Il link di recupero è scaduto. Richiedine uno nuovo dalla schermata di accesso.";
  return "Il link di recupero non è valido. Richiedine uno nuovo dalla schermata di accesso.";
}

export default function PasswordResetPage() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(() => recoveryLinkError());
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase || error) {
      if (!supabase) setError("Configura Supabase per reimpostare la password.");
      return;
    }

    let active = true;
    let recoveryEventReceived = false;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" && session) {
        recoveryEventReceived = true;
        setReady(true);
      }
      if (event === "SIGNED_OUT") setReady(false);
    });

    supabase.auth.getSession().then(({ data: sessionData, error: sessionError }) => {
      if (!active || recoveryEventReceived) return;
      if (sessionError) setError("Il link di recupero non è più valido. Richiedine uno nuovo dalla schermata di accesso.");
      else if (sessionData.session) setReady(true);
      else setError("Il link di recupero è scaduto o non è valido. Richiedine uno nuovo dalla schermata di accesso.");
    }).catch(() => {
      if (active) setError("Non è stato possibile verificare il link. Richiedine uno nuovo dalla schermata di accesso.");
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [error]);

  async function updatePassword(event) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (password.length < 12) {
      setError("Scegli una password di almeno 12 caratteri.");
      return;
    }
    if (password !== confirmation) {
      setError("Le password non coincidono.");
      return;
    }

    setBusy(true);
    try {
      if (!supabase) throw new Error("Configura Supabase per reimpostare la password.");
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw new Error("Non è stato possibile aggiornare la password. Il link potrebbe essere scaduto: richiedine uno nuovo.");
      await supabase.auth.signOut();
      window.location.replace("/?password=updated");
    } catch (failure) {
      setPassword("");
      setConfirmation("");
      setError(failure.message || "Connessione non disponibile. Riprova.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="booking-admin booking-login">
    <h1>Reimposta password</h1>
    {!ready && !error && <p role="status">Verifica del link di recupero…</p>}
    {ready && <>
      <p>Inserisci e conferma la nuova password.</p>
      <form onSubmit={updatePassword} className="booking-admin-form">
        <label>Nuova password
          <input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={1000} required
            value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <label>Conferma password
          <input name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={1000} required
            value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        </label>
        <button type="submit" disabled={busy}>{busy ? "Salvataggio…" : "Salva nuova password"}</button>
      </form>
    </>}
    {error && <p role="alert">{error}</p>}
    {(error || ready) && <a href="/">Torna all’accesso</a>}
  </main>;
}