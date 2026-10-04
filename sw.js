// Cosmic Balance service worker: shows notifications sent to this phone and
// opens the app at the right place when one is tapped. It doesn't cache
// anything: the app always loads fresh.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const here = (path) => new URL(path, self.registration.scope).href;

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const shown = self.registration.showNotification(data.title || 'Cosmic Balance', {
    body: data.body || 'Something new in Cosmic Balance',
    icon: here('icon-192.png'),
    badge: here('badge-96.png'),
    tag: data.tag,
    data: { url: here(data.url || '') },
  });
  const badge =
    typeof data.unread === 'number' && self.navigator && 'setAppBadge' in self.navigator
      ? self.navigator.setAppBadge(data.unread).catch(() => {})
      : Promise.resolve();
  event.waitUntil(Promise.all([shown, badge]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if (w.url.startsWith(self.registration.scope) && 'focus' in w) {
          w.postMessage({ type: 'open', url });
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
