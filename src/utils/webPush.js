function isIOS(navigatorObject) {
  return /iphone|ipad|ipod/i.test(navigatorObject.userAgent || '')
    || (navigatorObject.platform === 'MacIntel' && navigatorObject.maxTouchPoints > 1);
}

function isStandalone(windowObject, navigatorObject) {
  return navigatorObject.standalone === true
    || windowObject.matchMedia?.('(display-mode: standalone)').matches === true;
}

export function notificationPermissionState(environment = globalThis) {
  const windowObject = environment.window || environment;
  const navigatorObject = environment.navigator || windowObject.navigator || {};

  if (!windowObject.isSecureContext) return 'unsupported';
  if (isIOS(navigatorObject) && !isStandalone(windowObject, navigatorObject)) {
    return 'standalone-required';
  }

  const notificationApi = windowObject.Notification;
  if (!notificationApi || !['default', 'granted', 'denied'].includes(notificationApi.permission)
    || !windowObject.PushManager || !navigatorObject.serviceWorker) {
    return 'unsupported';
  }

  return notificationApi.permission;
}

export function shouldShowPushPanel({ permission, subscribed, error }) {
  return permission !== 'granted' || subscribed !== true || Boolean(error);
}

export function requestNotificationPermission(environment = globalThis) {
  const windowObject = environment.window || environment;
  if (notificationPermissionState(environment) !== 'default') {
    throw new Error('Il permesso per le notifiche non può essere richiesto in questo stato.');
  }

  return windowObject.Notification.requestPermission();
}

export function decodeApplicationServerKey(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]+$/.test(key)) {
    throw new Error('La chiave pubblica VAPID non è valida.');
  }
  const base64 = key.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0));
  if (bytes.length !== 65 || bytes[0] !== 4) {
    throw new Error('La chiave pubblica VAPID non è valida.');
  }
  return bytes;
}

export function pushSubscriptionRecord(subscription, userId) {
  const { endpoint, expirationTime, keys } = subscription.toJSON();
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://')
    || typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string') {
    throw new Error('La subscription push del dispositivo non è valida.');
  }

  return {
    user_id: userId,
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    expiration_time: expirationTime != null ? new Date(expirationTime).toISOString() : null,
  };
}

export async function savePushSubscription(client, userId, subscription) {
  const record = pushSubscriptionRecord(subscription, userId);
  const { error } = await client.from('admin_push_subscriptions')
    .upsert(record, { onConflict: 'endpoint' });
  if (error) throw new Error(`Salvataggio subscription push non riuscito: ${error.message}`);
}

export async function removePushSubscription(client, userId, subscription) {
  if (subscription) {
    const { error } = await client.from('admin_push_subscriptions').delete()
      .eq('user_id', userId).eq('endpoint', subscription.endpoint);
    if (error) throw new Error(`Rimozione subscription push non riuscita: ${error.message}`);
    const removed = await subscription.unsubscribe();
    if (!removed) throw new Error('La subscription locale non è stata rimossa dal browser.');
  }
}

export async function getAuthenticatedAdmin(client) {
  if (!client) throw new Error('Supabase non è configurato.');
  const { data, error } = await client.auth.getUser();
  if (error) throw new Error(`Verifica sessione non riuscita: ${error.message}`);
  if (!data.user || data.user.app_metadata?.role !== 'admin') {
    throw new Error('Accesso riservato allo staff.');
  }
  return data.user;
}

export async function getWebPushPublicKey(client) {
  const { data, error } = await client.functions.invoke('web-push-admin', {
    body: { action: 'config' },
  });
  if (error) throw new Error(`Configurazione push non disponibile: ${error.message}`);
  if (typeof data?.publicKey !== 'string') {
    throw new Error('La chiave pubblica VAPID non è configurata sul server.');
  }
  return data.publicKey;
}

export async function prepareAdminPush(client, navigatorObject = navigator) {
  const user = await getAuthenticatedAdmin(client);
  const registration = await navigatorObject.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  const publicKey = subscription ? null : await getWebPushPublicKey(client);
  return { user, registration, subscription, publicKey };
}

export async function subscribeAdminPush(client, navigatorObject = navigator, prepared) {
  const setup = prepared || await prepareAdminPush(client, navigatorObject);
  let subscription = setup.subscription;
  if (!subscription) {
    if (!setup.publicKey) throw new Error('Chiave pubblica VAPID non disponibile. Riprova tra poco.');
    subscription = await setup.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeApplicationServerKey(setup.publicKey),
    });
  }
  await savePushSubscription(client, setup.user.id, subscription);
  return subscription;
}

export async function unsubscribeAdminPush(client, navigatorObject = navigator) {
  const user = await getAuthenticatedAdmin(client);
  const registration = await navigatorObject.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  await removePushSubscription(client, user.id, subscription);
}

export async function sendTestPush(client, endpoint) {
  const { data, error } = await client.functions.invoke('web-push-admin', {
    body: { action: 'test', endpoint },
  });
  if (error) {
    if (error.context?.status === 410) {
      const staleError = new Error('Subscription scaduta o non più valida: è stata rimossa. Attiva di nuovo le notifiche su questo dispositivo.');
      staleError.name = 'InvalidPushSubscriptionError';
      throw staleError;
    }
    throw new Error(`Invio push di prova non riuscito: ${error.message}`);
  }
  if (!data?.sent) throw new Error('Il server non ha confermato l’invio del push di prova.');
  return data;
}
