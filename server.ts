// Vercel Node.js server entry point for the browser build of «Купол».
// The game uses the HTTP server for static assets and /ws for its authoritative
// single-player session. Vercel's Node server runtime provides WebSocket support.
if (process.env.VERCEL === '1') {
  process.env.HOST = '0.0.0.0';
  // «Купол» does not require the parent app's external live-data API proxies.
  // Avoid loading Vite and its development-only dependencies at runtime.
  process.env.GEV_API_PROXIES = '0';
}

await import('./server.js');
