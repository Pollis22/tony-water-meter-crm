// Minimal service worker: enables "Add to Home Screen" installability without
// caching anything, so there are no stale-asset or stale-API bugs to chase.
// Tony works in the field with a connection; offline caching can come later.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* network passthrough */ });
