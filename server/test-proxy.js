const { createProxyMiddleware } = require('http-proxy-middleware');
const express = require('express');
const app = express();

const aiprocessRoutes = [
    '/api/transcriptions',
    '/api/projects'
];

app.use(createProxyMiddleware({
    target: 'http://localhost:8081',
    changeOrigin: true,
    pathFilter: aiprocessRoutes,
    on: {
      proxyReq: (proxyReq, req, res) => {
        console.log('Proxied:', req.method, req.url);
      }
    }
}));

app.get('*', (req, res) => res.status(404).json({ error: 'Fell through' }));

const server = app.listen(8080, () => {
  const http = require('http');
  const req1 = http.request('http://localhost:8080/api/transcriptions', res => res.on('data', d => console.log('Response 1:', res.statusCode)));
  req1.end();
  
  const req2 = http.request('http://localhost:8080/api/transcriptions?page=1', res => res.on('data', d => console.log('Response 2:', res.statusCode)));
  req2.end();
  
  const req3 = http.request('http://localhost:8080/api/transcriptions/123/metadata', res => res.on('data', d => console.log('Response 3:', res.statusCode)));
  req3.end();
  
  setTimeout(() => server.close(), 1000);
});
