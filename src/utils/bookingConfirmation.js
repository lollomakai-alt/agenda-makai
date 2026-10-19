import { bookingStatus } from "./bookingStatus.js";
import { communicationMessage } from "../../supabase/functions/agenda-communications/messages.js";

export function confirmationMessage(booking, channel = "email") {
  const confirmation = communicationMessage(booking, 'confirmation', channel).text;
  const privacyUrl = new URL("/privacy", import.meta.env?.VITE_PUBLIC_SITE_URL || "http://localhost:5173").href;
  return `${confirmation}\n\nUtilizziamo i tuoi dati per gestire la prenotazione. Informativa privacy: ${privacyUrl}`;
}

export function confirmationEmailUrl(booking) {
  if (bookingStatus(booking.status) !== "confirmed") return null;
  const email = String(booking.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return null;
  const subject = communicationMessage(booking, 'confirmation').subject;
  const body = confirmationMessage(booking);
  const encodedSubject = encodeURIComponent(subject);
  const encodedBody = encodeURIComponent(body);
  return `mailto:${email}?subject=${encodedSubject}&body=${encodedBody}`;
}

export function confirmationWhatsAppUrl(booking) {
  if (bookingStatus(booking.status) !== "confirmed") return null;
  let phone = String(booking.phone || "").trim().replace(/[\s().-]/g, "");
  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;
  if (/^3[0-9]{8,9}$/.test(phone)) phone = `+39${phone}`;
  if (!/^\+[1-9][0-9]{5,14}$/.test(phone)) return null;
  const text = confirmationMessage(booking, "whatsapp");
  const encodedText = encodeURIComponent(text);
  return `https://wa.me/${phone.slice(1)}?text=${encodedText}`;
}
