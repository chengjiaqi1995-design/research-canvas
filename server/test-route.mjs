import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

const targetApp = express();
targetApp.use('/api/transcriptions', (req, res) => {
  res.status(200).json({ matched: true, path: req.path, url: req.url, originalUrl: req.originalUrl });
});
const server1 = targetApp.listen(8081);

const app = express();
const aiprocessRoutes = ['/api/transcriptions'];
app.use(aiprocessRoutes, createProxyMiddleware({ target: 'http://localhost:8081', changeOrigin: true }));
const server2 = app.listen(8080, async () => {
    try {
        const res = await fetch('http://localhost:8080/api/transcriptions/from-text', { method: 'POST' });
        console.log('Status:', res.status);
        if (res.ok) {
            console.log('Body:', await res.json());
        } else {
            console.log('Error Body:', await res.text());
        }
    } catch(e) { console.error(e) }
    server1.close();
    server2.close();
});
