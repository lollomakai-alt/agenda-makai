export function todayInRome() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type) => parts.find((item) => item.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function isMonth(value) {
  return /^[1-9][0-9]{3}-(0[1-9]|1[0-2])$/.test(value || "");
}

export function isDay(value) {
  if (!/^[1-9][0-9]{3}-(0[1-9]|1[0-2])-[0-9]{2}$/.test(value || "")) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function shiftMonth(month, amount) {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + amount);
  const result = date.toISOString().slice(0, 7);
  return isMonth(result) ? result : null;
}

export function calendarCells(month) {
  const first = new Date(`${month}-01T12:00:00Z`);
  const offset = (first.getUTCDay() + 6) % 7;
  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1);
  last.setUTCDate(0);
  const days = last.getUTCDate();
  return Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, index) => {
    const day = index - offset + 1;
    return day > 0 && day <= days ? `${month}-${String(day).padStart(2, "0")}` : null;
  });
}

export function monthLabel(month) {
  return new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${month}-01T12:00:00Z`));
}

export function dayLabel(day) {
  return new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${day}T12:00:00Z`));
}
