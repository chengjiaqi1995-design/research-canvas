const fetch = require('node-fetch');

async function search() {
  const userId = 'd1c31c0c-0aa3-4ad7-8f84-f8c1b2fb1454';
  const headers = { 'X-User-Id': userId };
  
  const wRes = await fetch('http://localhost:8080/api/workspaces', { headers });
  const workspaces = await wRes.json();
  
  const cRes = await fetch('http://localhost:8080/api/canvases', { headers });
  const canvases = await cRes.json();

  let found = false;
  
  console.log('--- SEARCHING FOR "欧陆通" IN CANVASES ---');
  for (const c of canvases) {
     if (c.title && c.title.includes('欧陆通')) {
        const ws = workspaces.find(w => w.id === c.workspaceId);
        console.log(`Found Canvas!`);
        console.log(`Title: ${c.title}`);
        console.log(`Located inside Workspace: ${ws ? ws.name : 'Unknown'} (${c.workspaceId})`);
        console.log(`Nodes inside: ${c.nodeCount}`);
        found = true;
     }
  }

  if (!found) {
    console.log('No Canvas named "欧陆通" exists.');
  }

}
search().catch(console.error);
