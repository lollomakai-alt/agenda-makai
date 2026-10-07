const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
};

function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers });
}

function pushStatus(error) {
  return error?.statusCode ?? error?.status ?? error?.response?.statusCode;
}

export function createWebPushHandler(dependencies) {
  return async function handleWebPush(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return response(405, { error: 'Metodo non consentito.' });

    const authorization = request.headers.get('authorization') || '';
    const token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1];
    if (!token) return response(401, { error: 'Autenticazione richiesta.' });

    let user;
    try {
      user = await dependencies.resolveUser(token);
    } catch {
      return response(503, { error: 'Verifica della sessione non disponibile.' });
    }
    if (!user) return response(401, { error: 'Sessione non valida.' });
    if (user.app_metadata?.role !== 'admin') {
      return response(403, { error: 'Accesso riservato allo staff.' });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return response(400, { error: 'Richiesta JSON non valida.' });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return response(400, { error: 'Richiesta non valida.' });
    }

    if (body.action === 'config') {
      if (!dependencies.publicKey) return response(503, { error: 'Chiave pubblica VAPID non configurata.' });
      return response(200, { publicKey: dependencies.publicKey });
    }

    if (body.action !== 'test') return response(400, { error: 'Azione non supportata.' });
    if (typeof body.endpoint !== 'string' || !body.endpoint.startsWith('https://') || body.endpoint.length > 4096) {
      return response(400, { error: 'Endpoint push non valido.' });
    }
    if (!dependencies.publicKey || !dependencies.privateKey || !dependencies.subject) {
      return response(503, { error: 'Configurazione VAPID incompleta sul server.' });
    }

    let subscription;
    try {
      subscription = await dependencies.findSubscription(user.id, body.endpoint);
    } catch {
      return response(500, { error: 'Lettura della subscription non riuscita.' });
    }
    if (!subscription) return response(404, { error: 'Subscription non trovata per questo account ADMIN.' });

    if (subscription.expiration_time && Date.parse(subscription.expiration_time) <= Date.now()) {
      try {
        await dependencies.deleteSubscription(user.id, body.endpoint);
      } catch {
        return response(500, { error: 'Subscription scaduta; rimozione dal server non riuscita.' });
      }
      return response(410, { error: 'Subscription scaduta e rimossa. Attiva di nuovo le notifiche su questo dispositivo.' });
    }

    try {
      await dependencies.sendNotification(subscription, JSON.stringify({
        title: 'Agenda Makai · Test push',
        body: 'Notifica di prova inviata manualmente dall’area ADMIN.',
        url: '/prenotazioni',
      }), {
        publicKey: dependencies.publicKey,
        privateKey: dependencies.privateKey,
        subject: dependencies.subject,
      });
      return response(200, { sent: true });
    } catch (error) {
      if (pushStatus(error) === 404 || pushStatus(error) === 410) {
        try {
          await dependencies.deleteSubscription(user.id, body.endpoint);
        } catch {
          return response(500, { error: 'Subscription non valida; rimozione dal server non riuscita.' });
        }
        return response(410, { error: 'Subscription non più valida e rimossa. Attiva di nuovo le notifiche su questo dispositivo.' });
      }
      return response(502, { error: 'Il push service non ha accettato la notifica di prova.' });
    }
  };
}
