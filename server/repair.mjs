import fetch from 'node-fetch';

async function repair() {
  const userId = 'd1c31c0c-0aa3-4ad7-8f84-f8c1b2fb1454';
  const headers = { 'X-User-Id': userId, 'Content-Type': 'application/json' };
  
  console.log('--- FETCHING ALL CANVASES ---');
  const cRes = await fetch('http://localhost:8080/api/canvases', { headers });
  let canvases = await cRes.json();
  canvases = Array.isArray(canvases) ? canvases : (canvases.data || canvases.canvases || []);
  
  console.log(`Found ${canvases.length} total Canvases to scan.`);
  let repairedCount = 0;

  for (const c of canvases) {
     const dataRes = await fetch(`http://localhost:8080/api/canvases/${c.id}`, { headers });
     const data = await dataRes.json();
     if (!data || !data.nodes) continue;
     
     const nodes = data.nodes || [];
     let needsUpdate = false;

     for (let i = 0; i < nodes.length; i++) {
         const node = nodes[i];
         if (node.isMain === true && node.type === 'markdown') {
             console.log(`[REPAIR] Found corrupted hidden note in Canvas [${c.title}]`);
             nodes[i].isMain = false;
             needsUpdate = true;
             repairedCount++;
         }
     }

     if (needsUpdate) {
         console.log(`-> Sending batch node update for ${c.title}...`);
         
         const payload = { ...data, nodes };
         
         const updateRes = await fetch(`http://localhost:8080/api/canvases/${c.id}`, {
             method: 'PUT',
             headers,
             body: JSON.stringify(payload)
         });
         
         if (!updateRes.ok) {
             console.error(`Failed to update ${c.title}`, await updateRes.text());
         }
     }
  }

  console.log(`\n🎉 SCAN COMPLETE. Successfully recovered ${repairedCount} hidden notes across all Canvases!`);
}
repair().catch(console.error);
