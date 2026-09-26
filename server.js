const express = require('express');
const path = require('path');

const app = express();
const HOST = '0.0.0.0';

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Vercel serverless functions in api/
const accountHandler = require('./api/admin/account');
const dataHandler = require('./api/admin/data');
const profileHandler = require('./api/auth/profile');
const summaryHandler = require('./api/financial/summary');

app.all('/api/admin/account', (req, res) => accountHandler(req, res));
app.all('/api/admin/data', (req, res) => dataHandler(req, res));
app.all('/api/auth/profile', (req, res) => profileHandler(req, res));
app.all('/api/financial/summary', (req, res) => summaryHandler(req, res));

// Static files
app.use(express.static(path.resolve(__dirname), {
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
app.use((req, res) => {
  res.sendFile(path.resolve(__dirname, 'index.html'));
});

const PORT = 3000;

app.listen(PORT, HOST, () => {
  console.log(`Mitali Hospital server running on http://${HOST}:${PORT}`);
});
