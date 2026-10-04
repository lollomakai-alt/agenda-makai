import { bookingStatus } from "./bookingStatus.js";

export function confirmationMessage(booking, channel = "email") {
  const [year, month, day] = booking.booking_date.split("-");
  const confirmation = `Ciao ${booking.name}! 🏴‍☠️\n\nPRENOTAZIONE CONFERMATA\n\nNome: ${booking.name}\nData: ${day}/${month}/${year}\nOra: ${booking.booking_time.slice(0, 5)}\nPersone: ${booking.party_size}\n\nLa prenotazione è già confermata: non serve rispondere. Ti aspettiamo al Makai Grand Line Pigneto!`;
  const privacyUrl = new URL("/privacy", import.meta.env?.VITE_PUBLIC_SITE_URL || "http://localhost:5173").href;
  const replyChannel = channel === "whatsapp" ? "a questo messaggio" : "a questa email";
  return `${confirmation}\n\nUN VANTAGGIO PER LA NOSTRA CIURMA ✨\n\nTi va di ricevere di tanto in tanto su WhatsApp offerte, sconti speciali, novità ed eventi riservati alla ciurma del Makai? Potremo anche dedicarti un pensiero per il compleanno e iniziative legate alle tue visite.\n\nLa scelta è facoltativa, non cambia la prenotazione e puoi revocarla quando vuoi. Se ti fa piacere, basta rispondere ${replyChannel} anche solo “Sì” oppure “Confermo”. Se non ti interessa, non serve rispondere.\n\nUtilizziamo i tuoi dati per gestire la prenotazione. Informativa privacy: ${privacyUrl}`;
}

export function confirmationEmailUrl(booking) {
  if (bookingStatus(booking.status) !== "confirmed") return null;
  const email = String(booking.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return null;
  const [year, month, day] = booking.booking_date.split("-");
  const subject = `Conferma prenotazione Makai - ${day}/${month}/${year}`;
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(confirmationMessage(booking))}`;
}

export function confirmationWhatsAppUrl(booking) {
  if (bookingStatus(booking.status) !== "confirmed") return null;
  let phone = String(booking.phone || "").trim().replace(/[\s().-]/g, "");
  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;
  if (/^3[0-9]{8,9}$/.test(phone)) phone = `+39${phone}`;
  if (!/^\+[1-9][0-9]{5,14}$/.test(phone)) return null;
  return `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(confirmationMessage(booking, "whatsapp"))}`;
}
