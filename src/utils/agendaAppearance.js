export const APPEARANCE_STORAGE_KEY = 'makai-agenda-appearance';
export const APPEARANCE_CHOICES = ['auto', 'light', 'dark'];

export function normalizeAppearance(value) {
  return APPEARANCE_CHOICES.includes(value) ? value : 'auto';
}

const romeHour = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Rome', hour: '2-digit', hourCycle: 'h23',
});

export function resolveAppearance(preference, now = new Date()) {
  const choice = normalizeAppearance(preference);
  if (choice !== 'auto') return choice;
  const hour = Number(romeHour.format(now));
  return hour >= 7 && hour < 19 ? 'light' : 'dark';
}

export function readAppearancePreference(storage) {
  try { return normalizeAppearance(storage.getItem(APPEARANCE_STORAGE_KEY)); }
  catch { return 'auto'; }
}
