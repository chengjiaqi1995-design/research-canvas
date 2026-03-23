import fetch from 'node-fetch';

async function check() {
  const userId = 'd1c31c0c-0aa3-4ad7-8f84-f8c1b2fb1454';
  const headers = { 'X-User-Id': userId };
  
  const cRes = await fetch('http://localhost:8080/api/canvases', { headers });
  let canvases = await cRes.json();
  canvases = Array.isArray(canvases) ? canvases : (canvases.data || canvases.canvases || []);

  const target = canvases.find(c => c.title && c.title.includes('欧陆通'));
  
  if (!target) {
     console.log('Canvas 欧陆通 does not exist in the database! Did you delete it?');
     return;
  }
  
  console.log(`Found Canvas: ${target.title} (ID: ${target.id})`);
  
  const dataRes = await fetch(`http://localhost:8080/api/canvases/${target.id}`, { headers });
  const data = await dataRes.json();
  const nodes = data.nodes || [];
  
  console.log(`It contains ${nodes.length} nodes.`);
  
  nodes.forEach((n, i) => {
      console.log(`\nNode [${i + 1}]:`);
      console.log(`  ID: ${n.id}`);
      console.log(`  Type: ${n.type}`);
      console.log(`  isMain: ${n.isMain}`);
      console.log(`  Title: ${n.data?.title}`);
      console.log(`  Position: x=${n.position?.x}, y=${n.position?.y}`);
  });
}
check().catch(console.error);
