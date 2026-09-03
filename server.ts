import express from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { getDb } from './server/db/index.js';
import { CncMonitorService } from './server/collector/cncMonitor.js';
import { GoogleSheetSyncService } from './server/sync/googleSheetSync.js';
import { createApiRouter } from './server/routes/api.js';

dotenv.config();

const PORT = 3000;

async function startServer() {
  const app = express();
  app.use(express.json());

  console.log('[Server] Connecting to database...');
  const db = await getDb();
  console.log('[Server] Database initialized successfully.');

  const defaultShare = fs.existsSync('./test_share') ? './test_share' : '\\\\192.168.11.211\\iso';
  const sharePath = process.env.CNC_SHARE_PATH || defaultShare;

  // Initialize and start background services (runs continuously on the server)
  const cncMonitor = new CncMonitorService(db, sharePath);
  cncMonitor.start();

  const googleSync = new GoogleSheetSyncService(db);
  googleSync.start();

  // Mount API router
  app.use('/api', createApiRouter(db, cncMonitor, googleSync));

  // Catch unhandled /api calls and return JSON 404, never fallback to HTML SPA
  app.all('/api/*', (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
  });

  // Global API error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.originalUrl && req.originalUrl.startsWith('/api')) {
      console.error('[API Error]', err);
      return res.status(500).json({ error: err?.message || 'Internal API error' });
    }
    next(err);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] CNC Production Monitoring Server running on http://0.0.0.0:${PORT}`);
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[Server] Port ${PORT} is already in use by an existing process.`);
      process.exit(1);
    } else {
      console.error('[Server] Server error:', err);
      process.exit(1);
    }
  });

  // Graceful shutdown hooks
  const shutdown = () => {
    console.log('[Server] Shutting down gracefully...');
    cncMonitor.stop();
    googleSync.stop();
    server.close(() => {
      console.log('[Server] Closed.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch(err => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
