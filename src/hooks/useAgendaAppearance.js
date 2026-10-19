import { useLayoutEffect, useState } from 'react';
import { APPEARANCE_STORAGE_KEY, normalizeAppearance, readAppearancePreference, resolveAppearance } from '../utils/agendaAppearance';

export default function useAgendaAppearance() {
  const [preference, setPreference] = useState(() => {
    if (typeof window === 'undefined') return 'auto';
    try { return readAppearancePreference(window.localStorage); }
    catch { return 'auto'; }
  });

  useLayoutEffect(() => {
    let timer;
    const refresh = () => {
      document.documentElement.dataset.agendaTheme = resolveAppearance(preference);
      document.documentElement.dataset.agendaAppearance = preference;
    };
    const tick = () => {
      refresh();
      timer = window.setTimeout(tick, 60000 - (Date.now() % 60000));
    };
    const sync = event => {
      if (event.key === APPEARANCE_STORAGE_KEY || event.key === null) {
        try { setPreference(readAppearancePreference(window.localStorage)); }
        catch { setPreference('auto'); }
      }
    };
    tick();
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', sync);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', sync);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [preference]);

  function changePreference(value) {
    const choice = normalizeAppearance(value);
    setPreference(choice);
    try { window.localStorage.setItem(APPEARANCE_STORAGE_KEY, choice); }
    catch { /* La scelta resta attiva anche quando il browser non consente il salvataggio. */ }
  }
  return { preference, changePreference };
}
