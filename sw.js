// TeleDrive Service Worker - Background Upload & Notification Manager
const CACHE_NAME = 'teledrive-v20261017_d';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/css/main.css',
  '/js/config.js?v=20261017_d',
  '/js/state.js?v=20261017_d',
  '/js/utils.js?v=20261017_d',
  '/js/api.js?v=20261017_d',
  '/js/db.js?v=20261017_d',
  '/js/router.js?v=20261017_d',
  '/js/render.js?v=20261017_d',
  '/js/dialogs.js?v=20261017_d',
  '/js/admin.js?v=20261017_d',
  '/js/mobile-bg.js?v=20261017_d',
  '/js/main.js?v=20261017_d'
];

self.addEventListener('install', function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(ASSETS_TO_CACHE).catch(function(e) {
        console.warn('SW pre-cache warning:', e);
      });
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.map(function(k) {
          if (k !== CACHE_NAME) return caches.delete(k);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// Network-first strategy for dynamic data, cache-first fallback for offline app shell
self.addEventListener('fetch', function(event) {
  const url = new URL(event.request.url);

  // Bypass API and Google Drive endpoints completely
  if (url.pathname.startsWith('/api/') || url.hostname.includes('googleapis.com')) {
    return;
  }

  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request).then(function(response) {
      if (response && response.status === 200 && response.type === 'basic') {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, copy);
        });
      }
      return response;
    }).catch(function() {
      return caches.match(event.request);
    })
  );
});

// ─── Notification Click: Focus existing tab or open fresh ───
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});

// ─── Background Upload Notification Manager ───
self.addEventListener('message', function(event) {
  if (!event.data) return;
  const data = event.data;

  if (data.type === 'SHOW_UPLOAD_NOTIFICATION') {
    const title = data.title || 'TeleDrive Uploading…';
    const options = Object.assign({
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: 'teledrive-upload-progress',
      renotify: false,
      silent: true
    }, data.options || {});

    self.registration.showNotification(title, options).catch(function(e) {
      console.warn('SW notification error:', e);
    });
  }

  if (data.type === 'UPLOAD_FINISHED_NOTIFICATION') {
    self.registration.showNotification(data.title || 'Upload Complete! 🎉', {
      body: data.body || 'All files have been uploaded to TeleDrive.',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: 'teledrive-upload-finished',
      renotify: true,
      vibrate: [200, 100, 200],
      requireInteraction: false
    }).catch(function(){});
  }

  if (data.type === 'CLEAR_UPLOAD_NOTIFICATION') {
    self.registration.getNotifications({ tag: 'teledrive-upload-progress' }).then(function(notifications) {
      notifications.forEach(function(n) { n.close(); });
    }).catch(function(){});
  }
});
