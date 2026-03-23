import fetch from 'node-fetch';

async function search() {
  const userId = 'd1c31c0c-0aa3-4ad7-8f84-f8c1b2fb1454';
  const headers = { 'X-User-Id': userId };
  
  const cRes = await fetch('http://localhost:8080/api/canvases', { headers });
  let canvases = await cRes.json();
  canvases = Array.isArray(canvases) ? canvases : (canvases.data || canvases.canvases || []);

  let found = false;
  
  console.log('--- GLOBAL DEEP CONTENT SEARCH FOR "欧陆通" OR "潍柴" ---');
  for (const c of canvases) {
     const dataRes = await fetch(`http://localhost:8080/api/canvas-data/${c.id}`, { headers });
     const data = await dataRes.json();
     const nodes = data.nodes || [];
     
     for (const node of nodes) {
         const title = node.data?.title || '';
         const content = node.data?.content || '';
         
         if (title.includes('欧陆通') || content.includes('欧陆通') || title.includes('潍柴') || content.includes('潍柴')) {
             console.log(`\n🚨 FOUND DEEP NOTE!`);
             console.log(`Note Title: ${title}`);
             console.log(`Sitting inside Canvas: [${c.title}] (ID: ${c.id})`);
             console.log(`Position Stack: x=${node.position?.x}, y=${node.position?.y}`);
             found = true;
         }
     }
  }

  if (!found) {
    console.log('\n❌ NEITHER NOTE EXISTS ANYWHERE IN THE ENTIRE DATABASE.');
    console.log('This means AI Notebook literally did not return them during the last sync.');
  }
}
search().catch(console.error);
