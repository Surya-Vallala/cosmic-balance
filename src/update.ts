// Picking up a new version of the web app without closing it.
//
// The installed app can stay open in the background for days. When it comes
// back to the screen, it checks whether a newer version has been published
// (the page names a different app file) and, if so, reloads: straight away
// on screens with nothing typed, or when the user taps Refresh on the bar
// shown over a form. Changes not yet sent are kept on the phone, so a reload
// loses nothing.
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { APP_BASE } from './push';

const web = Platform.OS === 'web' && typeof window !== 'undefined' && typeof document !== 'undefined';
const BUNDLE = /\/_expo\/static\/js\/web\/[^"'\s]+\.js/;

/** The app file this copy is running (null when not a published build). */
function runningBundle(): string | null {
  for (const s of Array.from(document.scripts)) {
    const m = s.src.match(BUNDLE);
    if (m) return m[0];
  }
  return null;
}

/** The app file the published page names now. */
async function publishedBundle(): Promise<string | null> {
  const res = await fetch(`${APP_BASE}?check=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return (await res.text()).match(BUNDLE)?.[0] ?? null;
}

/** The newer version's app file, or null when this copy is the latest. */
export async function newerVersion(): Promise<string | null> {
  if (!web) return null;
  const mine = runningBundle();
  if (!mine) return null; // running from the development server
  const latest = await publishedBundle().catch(() => null);
  return latest && latest !== mine ? latest : null;
}

// Switching by itself is tried once per new version: if the phone still opens
// the old one (an old copy of the page kept somewhere), it doesn't keep
// reloading; the bar offers Refresh instead.
const TRIED = 'cosmic-khaata:update-tried';
function tried(latest: string): boolean {
  try {
    return sessionStorage.getItem(TRIED) === latest;
  } catch {
    return false;
  }
}
function markTried(latest: string): void {
  try {
    sessionStorage.setItem(TRIED, latest);
  } catch {
    // Not available: reloading still works.
  }
}

let leaving = false;
/** True while the app is reloading itself into a new version (which isn't the user leaving it). */
export function leavingForUpdate(): boolean {
  return leaving;
}

/** Load the newest version: refresh the phone's copies of the page, then reload. */
async function switchTo(latest?: string): Promise<void> {
  if (latest) markTried(latest);
  leaving = true;
  // The page as opened (with its screen in the address) and the bare one.
  const pages = [...new Set([window.location.href, new URL(APP_BASE, window.location.href).href])];
  await Promise.all(pages.map((u) => fetch(u, { cache: 'reload' }).catch(() => {})));
  window.location.reload();
}

/**
 * Watch for a newer version. `safeNow` says whether the current screen can be
 * reloaded without losing anything typed. Returns true when an update is
 * waiting for the user to tap Refresh.
 */
export function useAppUpdate(safeNow: () => boolean): boolean {
  const [waiting, setWaiting] = useState(false);
  const safe = useRef(safeNow);
  useEffect(() => {
    safe.current = safeNow;
  });

  useEffect(() => {
    if (!web) return;
    let last = 0;
    let busy = false;
    const check = async () => {
      if (busy || Date.now() - last < 30_000) return;
      busy = true;
      last = Date.now();
      try {
        // The service worker (notifications) can have a newer version too.
        void navigator.serviceWorker?.getRegistration?.().then((r) => r?.update()).catch(() => {});
        const latest = await newerVersion();
        if (latest) {
          waitingFor = latest;
          if (safe.current() && !tried(latest)) await switchTo(latest);
          else setWaiting(true);
        }
      } finally {
        busy = false;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const first = setTimeout(check, 15_000);
    const every = setInterval(() => document.visibilityState === 'visible' && void check(), 30 * 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);
  return waiting;
}

let waitingFor: string | null = null;

/**
 * Switch to the waiting version: when the user taps Refresh, or by itself on
 * leaving a form (`auto`, once per version).
 */
export function reloadApp(auto = false): void {
  if (!web) return;
  if (auto && waitingFor && tried(waitingFor)) return;
  void switchTo(waitingFor ?? undefined);
}
