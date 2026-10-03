import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return respond({ error: 'Metodo non consentito' }, 405);
  try {
    const raw = await request.text();
    if (raw.length > 8192) return respond({ error: 'Richiesta troppo grande' }, 413);
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return respond({ error: 'Dati non validi' }, 400);
    const fields = ['name', 'phone', 'email', 'booking_date', 'booking_time', 'notes'];
    if (fields.some(field => body[field] !== undefined && typeof body[field] !== 'string')) return respond({ error: 'Dati non validi' }, 400);
    const name = (body.name || '').trim().replace(/\s+/g, ' ');
    const phone = (body.phone || '').trim();
    const email = (body.email || '').trim().toLowerCase();
    const notes = (body.notes || '').trim();
    if (name.length > 60 || !/^[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*(?: [\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*)+$/u.test(name)
      || !/^\+[1-9][0-9]{7,14}$/.test(phone) || notes.length > 300
      || (email && (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
      || !Number.isInteger(body.party_size) || body.party_size < 1 || body.party_size > 6) return respond({ error: 'Nome, contatti o coperti non validi. Usa il telefono con prefisso internazionale.' }, 400);
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
    // Guest ownership stays NULL. Never accept user_id, status, tables, source or consent from the body.
    let userId: string | null = null;
    const authorization = request.headers.get('Authorization');
    if (authorization && authorization.replace(/^Bearer\s+/i, '') !== Deno.env.get('SUPABASE_ANON_KEY')) {
      const token = authorization.replace(/^Bearer\s+/i, '');
      const { data, error } = await client.auth.getUser(token);
      if (error || !data.user) return respond({ error: 'Sessione non valida' }, 401);
      userId = data.user.id;
    }
    const { data, error } = await client.from('bookings').insert({ name, phone, email, notes,
      booking_date: body.booking_date, booking_time: body.booking_time, party_size: body.party_size,
      source: 'booking', user_id: userId, status: 'confirmed', reminder_status: 'skipped' }).select('id,booking_date,booking_time,party_size,status').single();
    if (error) {
      if (error.code === 'P0001') return respond({ error: error.message }, 409);
      return respond({ error: 'Impossibile salvare la prenotazione' }, 400);
    }
    return respond({ booking: data }, 201);
  } catch {
    return respond({ error: 'Richiesta non valida' }, 400);
  }
});
