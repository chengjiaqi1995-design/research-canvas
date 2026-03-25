import https from 'https';

https.get('https://research-canvas-api-iwuz3k44oa-as.a.run.app/api/health', (res) => {
  console.log('statusCode:', res.statusCode);
  console.log('headers:', res.headers);
  res.on('data', (d) => {
    process.stdout.write(d);
  });
}).on('error', (e) => {
  console.error('HTTPS Error:', e);
});
