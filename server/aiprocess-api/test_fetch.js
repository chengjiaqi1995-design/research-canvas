fetch('http://localhost:8081/api/transcriptions?limit=5', {
  headers: {
    'X-Internal-API-Key': process.env.INTERNAL_API_KEY || '',
    'X-User-Id': 'dummy' // Doesn't matter for internal auth
  }
}).then(r => r.json()).then(r => {
  r.data.items.forEach(i => console.log(i.fileName, i.industry, i.metadata?.industry));
}).catch(console.error);
