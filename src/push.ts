// Phone notifications (Web Push) for the installed web app.
//
// Android (Chrome) and iPhone (iOS 16.4+, only once the app is added to the
// Home Screen) can show notifications while the app is closed. The phone asks
// permission once; after that, the database sends notifications through the
// send-push function to this phone's push service.
import { Platform } from 'react-native';
import { deletePushSubscription, pushPublicKey, runSendPush, savePushSubscription } from './cloud/api';

export type PushState =
  | 'unsupported' // this browser can't do it
  | 'install' // iPhone/iPad: add to Home Screen first
  | 'blocked' // notifications are turned off for this app in the phone's settings
  | 'off'
  | 'on';

const web = Platform.OS === 'web' && typeof window !== 'undefined' && typeof navigator !== 'undefined';

/** The folder the app is served from, e.g. "/cosmic-balance/". */
export const APP_BASE: string = (() => {
  if (!web) return '/';
  const path = window.location.pathname.replace(/index\.html$/, '');
  return path.endsWith('/') ? path : `${path}/`;
})();

function isApple(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function installed(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function supported(): boolean {
  return web && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

let registration: Promise<ServiceWorkerRegistration | null> | null = null;

/** The app's service worker (shows notifications). Registered once, when the app starts. */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!web || !('serviceWorker' in navigator)) return Promise.resolve(null);
  registration ??= navigator.serviceWorker
    .register(`${APP_BASE}sw.js`, { scope: APP_BASE })
    .catch(() => null);
  return registration;
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return web && isApple() && !installed() ? 'install' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await registerServiceWorker();
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

/**
 * Turn notifications on for this phone. Call it straight from a tap: phones
 * only ask for permission in response to one.
 */
export async function turnOnPush(): Promise<PushState> {
  if (!supported()) return pushState();
  // Ask before anything else, while the tap still counts.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  const reg = await registerServiceWorker();
  if (!reg) throw new Error('This browser couldn’t set up notifications. Try the installed app.');
  await navigator.serviceWorker.ready;

  let key = await pushPublicKey();
  if (!key) {
    // The send-push function makes the key pair the first time it runs.
    await runSendPush().catch(() => {});
    key = await pushPublicKey();
  }
  if (!key) {
    throw new Error(
      'Notifications aren’t set up on the server yet. Whoever set up Cosmic Balance: deploy the send-push function (see the README).',
    );
  }
  const appKey = fromB64url(key);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options.applicationServerKey, appKey)) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
  const json = sub.toJSON();
  if (!json.keys?.p256dh || !json.keys?.auth) throw new Error('This browser didn’t give a usable notification address.');
  await savePushSubscription(sub.endpoint, json.keys.p256dh, json.keys.auth);
  return 'on';
}

/** Stop notifications on this phone (also when signing out). */
export async function turnOffPush(): Promise<PushState> {
  if (!supported()) return pushState();
  const reg = await registerServiceWorker();
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  if (sub) {
    await deletePushSubscription(sub.endpoint).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return pushState();
}

/** If this phone already gets notifications, make sure the server still has it (after reinstalling, say). */
export async function refreshPushSubscription(): Promise<void> {
  if (!supported() || Notification.permission !== 'granted') return;
  const reg = await registerServiceWorker();
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  const json = sub?.toJSON();
  if (sub && json?.keys?.p256dh && json.keys.auth) {
    await savePushSubscription(sub.endpoint, json.keys.p256dh, json.keys.auth).catch(() => {});
  }
}

/** The number on the app icon (where the phone supports it). */
export function setBadge(count: number): void {
  if (!web) return;
  const n = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  if (count > 0) n.setAppBadge?.(count).catch(() => {});
  else n.clearAppBadge?.().catch(() => {});
}

/** Tapping a notification while the app is open: the service worker asks the app to go there. */
export function onNotificationTap(go: (url: string) => void): () => void {
  if (!web || !('serviceWorker' in navigator)) return () => {};
  const handler = (e: MessageEvent) => {
    if (e.data?.type === 'open' && typeof e.data.url === 'string') go(e.data.url);
  };
  navigator.serviceWorker.addEventListener('message', handler);
  return () => navigator.serviceWorker.removeEventListener('message', handler);
}
