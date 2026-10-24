import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { loadPendingBookingRequestCount } from '../utils/bookingRequests';

export default function CustomerRequestsNavLink({ active = false }) {
  const [state, setState] = useState({ count: 0, loading: true, error: false });
  const mounted = useRef(false);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try {
      const count = await loadPendingBookingRequestCount(supabase);
      if (mounted.current && current === generation.current) setState({ count, loading: false, error: false });
    } catch {
      if (mounted.current && current === generation.current) {
        setState(previous => ({ ...previous, loading: false, error: true }));
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = window.setInterval(refresh, 30000);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('booking-requests-changed', refresh);
    document.addEventListener('visibilitychange', onVisible);
    const { data } = supabase.auth.onAuthStateChange(() => {
      generation.current++;
      setState({ count: 0, loading: true, error: false });
      window.setTimeout(() => { if (mounted.current) void refresh(); }, 0);
    });
    return () => {
      mounted.current = false;
      generation.current++;
      window.clearInterval(timer);
      window.removeEventListener('booking-requests-changed', refresh);
      document.removeEventListener('visibilitychange', onVisible);
      data.subscription.unsubscribe();
    };
  }, [refresh]);

  const countLabel = state.loading ? 'conteggio in caricamento' : state.error
    ? 'conteggio non disponibile' : `${state.count} richieste da gestire`;
  return (
    <a
      className="dopocena-nav-link"
      href="/richieste-clienti"
      aria-current={active ? 'page' : undefined}
      aria-label={`Richieste clienti, ${countLabel}`}
    >
      <span>Richieste clienti</span>
      <span className="dopocena-nav-badge" aria-live="polite" aria-label={countLabel}>
        {state.loading || state.error ? '—' : state.count}
      </span>
    </a>
  );
}
