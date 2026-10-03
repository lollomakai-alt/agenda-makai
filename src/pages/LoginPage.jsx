import { supabase } from "../lib/supabase";
import { useEffect, useState } from "react";

export default function LoginPage() {
  const [settingPassword, setSettingPassword] = useState(new URLSearchParams(window.location.search).get('setup') === 'password' || /type=(invite|recovery)/.test(window.location.hash));
  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange(event => {
      if (event === 'PASSWORD_RECOVERY') setSettingPassword(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function login(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (!supabase) throw new Error("Configura Supabase per accedere.");
      if (settingPassword) {
        if (password.length < 12) throw new Error("Scegli una password di almeno 12 caratteri.");
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw new Error("Impossibile impostare la password. Riapri il link dell’invito.");
        window.location.replace('/prenotazioni');
        return;
      }
      const { data, error } = await supabase.auth.signInWithPassword({ email: username, password });
      if (error) throw new Error("Email o password non corrette.");
      if (!["staff", "admin"].includes(data.user.app_metadata?.role)) {
        await supabase.auth.signOut();
        throw new Error("Questo account non ha accesso staff.");
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
      {!settingPassword && <label>Email
        <input name="email" type="email" autoComplete="username" required maxLength={100}
          value={username} onChange={(event) => setUsername(event.target.value)} />
      </label>}
      <label>Password
        <input name="password" type="password" autoComplete={settingPassword ? "new-password" : "current-password"} minLength={settingPassword ? 12 : undefined} required maxLength={1000}
          value={password} onChange={(event) => setPassword(event.target.value)} />
      </label>
      <button type="submit" disabled={busy}>{busy ? "Attendi…" : settingPassword ? "Imposta password" : "Accedi"}</button>
    </form>
    {error && <p role="alert">{error}</p>}
  </main>;
}
