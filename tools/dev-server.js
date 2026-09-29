const express = require('express');
const path = require('path');

const app = express();
const projectRoot = path.resolve(__dirname, '..');
const PORT = 3000;
const HOST = '0.0.0.0';

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Vercel serverless functions in api/
const accountHandler = require('../api/admin/account');
const dataHandler = require('../api/admin/data');
const profileHandler = require('../api/auth/profile');
const summaryHandler = require('../api/financial/summary');

app.all('/api/admin/account', (req, res, next) => Promise.resolve(accountHandler(req, res)).catch(next));
app.all('/api/admin/data', (req, res, next) => Promise.resolve(dataHandler(req, res)).catch(next));
app.all('/api/auth/profile', (req, res, next) => Promise.resolve(profileHandler(req, res)).catch(next));
app.all('/api/financial/summary', (req, res, next) => Promise.resolve(summaryHandler(req, res)).catch(next));

// Static files
app.use(express.static(projectRoot, {
  index: 'index.html',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Service-Worker-Allowed', '/');
    } else if (filePath.endsWith('.webmanifest') || filePath.endsWith('manifest.json')) {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
  }
}));

// SPA Fallback
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    return res.sendFile(path.resolve(projectRoot, 'index.html'));
  }
  next();
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[dev-server error]', err);
  if (!res.headersSent) {
    res.status(err.status || 500).json({
      error: err.message || 'Internal server error',
      code: err.code || 'server-error'
    });
  }
});

// Primary port 3000 for AI Studio dev proxy
const server = app.listen(PORT, HOST, () => {
  console.log(`Mitali Hospital dev server running on http://${HOST}:${PORT}`);
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} is already in use, continuing.`);
  } else {
    console.error('Server error:', err);
  }
});

// If Cloud Run or deployed environment specifies a PORT (e.g. 8080), listen on it as well
const envPort = process.env.PORT ? parseInt(process.env.PORT, 10) : null;
if (envPort && envPort !== PORT) {
  const altServer = app.listen(envPort, HOST, () => {
    console.log(`Mitali Hospital server also listening on http://${HOST}:${envPort}`);
  });
  altServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${envPort} already bound, continuing on ${PORT}`);
    } else {
      console.error(`Alt port error:`, err.message);
    }
  });
}
