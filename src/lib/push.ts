import { api } from './api';

/* Web push helpers for "notify this device". */

export function pushSupport(): { ok: true } | { ok: false; reason: string } {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    return {
      ok: false,
      reason: ios
        ? 'On iPhone and iPad, add StreamForge to your Home Screen first (Share → Add to Home Screen), then open it from there.'
        : 'This browser doesn’t support push notifications.',
    };
  }
  if (!window.isSecureContext) return { ok: false, reason: 'Push notifications need StreamForge to be served over HTTPS.' };
  return { ok: true };
}

function keyBytes(base64url: string) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function deviceName() {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${browser} on ${os}`;
}

export async function currentSubscription() {
  if (!pushSupport().ok) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Whether this device is subscribed and the server knows about it. */
export async function isSubscribed() {
  const sub = await currentSubscription();
  if (!sub) return false;
  const r = await api<{ subscribed: boolean }>('/settings/notifications/push/status', { method: 'POST', body: { endpoint: sub.endpoint } });
  return r.subscribed;
}

export async function subscribe(publicKey: string) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are blocked for this site. Allow them in your browser settings and try again.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await api('/settings/notifications/push/subscribe', { method: 'POST', body: { ...sub.toJSON(), device: deviceName() } });
}

export async function unsubscribe() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api('/settings/notifications/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
  await sub.unsubscribe();
}
