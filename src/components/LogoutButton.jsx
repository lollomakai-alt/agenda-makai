import { supabase } from "../lib/supabase";
import { useState } from "react";

export default function LogoutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      window.location.replace("/");
    } catch {
      setError("Uscita non riuscita. Riprova.");
      setBusy(false);
    }
  }
  return <div className="admin-logout">
    <button className="admin-button admin-button-secondary" type="button" disabled={busy} onClick={logout}>{busy ? "Uscita…" : "Esci"}</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
