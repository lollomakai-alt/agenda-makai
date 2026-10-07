import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  getAuthenticatedAdmin,
  notificationPermissionState,
  prepareAdminPush,
  requestNotificationPermission,
  sendTestPush,
  subscribeAdminPush,
  unsubscribeAdminPush,
} from '../utils/webPush';

const permissionMessages = {
  granted: 'Permesso concesso. Attiva la subscription su questo dispositivo per ricevere notifiche.',
  denied: 'Permesso negato. Per attivare le notifiche, modifica le impostazioni del sito nel browser.',
  default: 'Consenti le notifiche su questo dispositivo tramite il pulsante qui sotto.',
  unsupported: 'Le notifiche non sono supportate in questo browser o contesto sicuro.',
  'standalone-required': 'Su iPhone e iPad, aggiungi Agenda Makai alla schermata Home e aprila da lì prima di attivare le notifiche.',
};

export default function AdminPushNotifications() {
  const [permission, setPermission] = useState(() => notificationPermissionState());
  const [subscribed, setSubscribed] = useState(null);
  const [prepared, setPrepared] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    async function refreshPermission() {
      const currentPermission = notificationPermissionState();
      setPermission(currentPermission);
      if (currentPermission !== 'granted' || !('serviceWorker' in navigator)) {
        setSubscribed(false);
        return;
      }
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (active) setSubscribed(Boolean(subscription));
      } catch (refreshError) {
        if (active) setError(refreshError instanceof Error ? refreshError.message : 'Impossibile verificare la subscription push.');
      }
    }
    async function prepare() {
      try {
        const setup = await prepareAdminPush(supabase);
        if (active) {
          setPrepared(setup);
          setSubscribed(Boolean(setup.subscription));
        }
      } catch (prepareError) {
        if (active) setError(prepareError instanceof Error ? prepareError.message : 'Configurazione Web Push non disponibile.');
      }
    }
    window.addEventListener('focus', refreshPermission);
    document.addEventListener('visibilitychange', refreshPermission);
    void refreshPermission();
    void prepare();
    return () => {
      active = false;
      window.removeEventListener('focus', refreshPermission);
      document.removeEventListener('visibilitychange', refreshPermission);
    };
  }, []);

  async function enableNotifications() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      let currentPermission = notificationPermissionState();
      if (currentPermission === 'default') {
        currentPermission = await requestNotificationPermission();
        setPermission(currentPermission);
        if (currentPermission === 'granted') {
          setNotice('Permesso concesso. Premi di nuovo “Attiva notifiche” per creare la subscription su questo dispositivo.');
        }
        return;
      }
      if (currentPermission !== 'granted') return;
      if (!prepared) throw new Error('Configurazione push ancora in caricamento. Riprova tra poco.');
      await subscribeAdminPush(supabase, navigator, prepared);
      setSubscribed(true);
      setPrepared({ ...prepared, subscription: await (await navigator.serviceWorker.ready).pushManager.getSubscription(), publicKey: null });
      setNotice('Notifiche attive su questo dispositivo. Puoi inviare un push di prova.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Impossibile richiedere il permesso per le notifiche.');
      setPermission(notificationPermissionState());
    } finally {
      setBusy(false);
    }
  }

  async function disableNotifications() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await unsubscribeAdminPush(supabase);
      setSubscribed(false);
      setNotice('Subscription rimossa da questo dispositivo.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Impossibile rimuovere la subscription push.');
    } finally {
      setBusy(false);
    }
  }

  async function testPush() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await getAuthenticatedAdmin(supabase);
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        setSubscribed(false);
        throw new Error('Nessuna subscription attiva su questo dispositivo. Attiva di nuovo le notifiche.');
      }
      await sendTestPush(supabase, subscription.endpoint);
      setNotice('Push di prova inviato. Controlla il Centro notifiche del dispositivo.');
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === 'InvalidPushSubscriptionError') {
        try {
          const registration = await navigator.serviceWorker.ready;
          const subscription = await registration.pushManager.getSubscription();
          if (subscription) await subscription.unsubscribe();
          const setup = await prepareAdminPush(supabase);
          setPrepared(setup);
          setSubscribed(Boolean(setup.subscription));
        } catch (cleanupError) {
          const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : 'Pulizia della subscription locale non riuscita.';
          setError(`${requestError.message} ${cleanupMessage}`);
          setSubscribed(false);
          setPrepared(null);
          return;
        }
      }
      setError(requestError instanceof Error ? requestError.message : 'Invio push di prova non riuscito.');
    }
    finally {
      setBusy(false);
    }
  }

  const available = (permission === 'default' || permission === 'granted') && (permission === 'default' || prepared !== null);
  return <section className="admin-push-notifications" aria-label="Notifiche push ADMIN">
    <h2>Notifiche push</h2>
    <p role="status">{permission === 'granted' && subscribed ? 'Subscription attiva su questo dispositivo.' : permissionMessages[permission]}</p>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    {!subscribed && <button type="button" className="admin-button admin-button-secondary" disabled={!available || busy} onClick={enableNotifications}>
      {busy ? 'Attivazione in corso…' : permission === 'granted' ? 'Completa attivazione' : 'Attiva notifiche'}
    </button>}
    {subscribed && <>
      <button type="button" className="admin-button admin-button-secondary" disabled={busy} onClick={testPush}>Invia push di prova</button>
      <button type="button" className="admin-button admin-button-secondary" disabled={busy} onClick={disableNotifications}>Disattiva notifiche</button>
    </>}
  </section>;
}
