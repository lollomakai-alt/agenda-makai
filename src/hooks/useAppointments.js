import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// agenda: staff-created rows; booking: customer rows; all: unified staff calendar.
export function useAppointments(view = 'all') {
  const [state, setState] = useState({ appointments: [], loading: true, error: null });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const applyUpdate = useCallback(booking => setState(previous => ({ ...previous,
    appointments: previous.appointments.map(item => String(item.id) === String(booking.id) ? { ...item, ...booking } : item),
  })), []);
  useEffect(() => {
    let active = true;
    let generation = 0;
    let channel;
    const valid = ['agenda', 'booking', 'all'].includes(view);
    if (!supabase || !valid) {
      setState({ appointments: [], loading: false, error: new Error(valid ? 'Configura Supabase.' : 'Vista non valida.') });
      return;
    }
    setState({ appointments: [], loading: true, error: null });
    async function load() {
      const current = ++generation;
      try {
        let query = supabase.from('bookings').select('*').order('booking_date').order('booking_time').order('id');
        if (view !== 'all') query = query.eq('source', view);
        const { data, error } = await query;
        if (active && current === generation) setState({ appointments: error ? [] : data, loading: false, error });
      } catch (error) {
        if (active && current === generation) setState({ appointments: [], loading: false, error });
      }
    }
    function subscribe() {
      if (channel) void supabase.removeChannel(channel);
      // Unfiltered notifications also catch source changes and DELETE (which cannot be filtered).
      // Every reload filters the query and is protected by RLS.
      channel = supabase.channel(`appointments-${view}-${crypto.randomUUID()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, load)
        .subscribe(status => {
          if (!active) return;
          if (status === 'SUBSCRIBED') void load();
          if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
            setState(previous => ({ ...previous, error: new Error('Sincronizzazione realtime interrotta.'), loading: false }));
          }
        });
    }
    const { data: auth } = supabase.auth.onAuthStateChange(() => {
      if (active) {
        generation++;
        setState({ appointments: [], loading: true, error: null });
        // Run outside the auth callback to avoid locking Supabase auth.
        setTimeout(() => { if (active) { subscribe(); void load(); } }, 0);
      }
    });
    subscribe();
    void load();
    function visible() { if (document.visibilityState === 'visible') void load(); }
    document.addEventListener('visibilitychange', visible);
    return () => { active = false; generation++; auth.subscription.unsubscribe(); document.removeEventListener('visibilitychange', visible); if (channel) void supabase.removeChannel(channel); };
  }, [view, revision]);
  return { ...state, refresh, applyUpdate };
}
