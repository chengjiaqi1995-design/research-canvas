import fetch from 'node-fetch';

async function search() {
  console.log('--- DIRECT API FETCH ---');
  const res = await fetch('http://localhost:8080/api/sync/fetch-notes');
  const data = await res.json();
  const items = data.data?.items || [];
  
  console.log(`Fetched ${items.length} notes from API.`);
  
  let stringDump = JSON.stringify(items);
  if (stringDump.includes('欧陆通') || stringDump.includes('潍柴')) {
      console.log('✅ THE API DID RETURN THEM! THEY ARE BEING HIDDEN BY THE FRONTEND LOOP.');
      const targets = items.filter(n => JSON.stringify(n).includes('欧陆通') || JSON.stringify(n).includes('潍柴'));
      targets.forEach(t => console.log('\n', JSON.stringify(t, null, 2)));
  } else {
      console.log('❌ THE API DID NOT RETURN THEM AT ALL! AI NOTEBOOK DID NOT SEND THEM!');
  }
}
search().catch(console.error);
