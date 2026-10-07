self.addEventListener('push', event => {
  if (!event.data) return;

  const payloadText = event.data.text();
  let payload;
  try {
    payload = JSON.parse(payloadText);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    payload = { body: payloadText };
  }

  const data = payload && typeof payload === 'object' ? payload : {};
  const title = typeof data.title === 'string' ? data.title : 'Agenda Makai';
  const body = typeof data.body === 'string' ? data.body : 'Hai una nuova notifica.';
  let safeUrl = '/prenotazioni';
  if (typeof data.url === 'string') {
    try {
      const target = new URL(data.url, self.location.origin);
      if (target.origin === self.location.origin) safeUrl = target.href;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
  }

  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/images/logo/logo-totem.png',
    data: { url: safeUrl },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/prenotazioni';
  event.waitUntil(self.clients.openWindow(url));
});
