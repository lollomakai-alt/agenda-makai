import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
export default function AdminAccess({ children }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    function check(session) {
      if (!active) return;
      if (!session || session.user.app_metadata?.role !== 'admin') { window.location.replace('/'); return; }
      setReady(true);
    }
    supabase.auth.getSession().then(({ data }) => check(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => check(session));
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  return ready ? children : <main className="booking-admin"><p role="status">{supabase ? 'Verifica dell’accesso…' : 'Configura Supabase per accedere.'}</p></main>;
}
