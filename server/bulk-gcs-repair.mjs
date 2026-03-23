import { Storage } from '@google-cloud/storage';

async function repairGCS() {
  console.log('--- CONNECTING TO GCS DATABASE (Bypassing API Auth) ---');
  const storage = new Storage();
  const bucket = storage.bucket('gen-lang-client-0634831802-uploads-asia');

  // get all files in `data/`
  console.log('Scanning all files...');
  const [files] = await bucket.getFiles({ prefix: 'data/' });
  
  // We only want to look at `canvases/*.json`
  const canvasFiles = files.filter(f => f.name.includes('/canvases/') && f.name.endsWith('.json'));
  console.log(`Found ${canvasFiles.length} canvas documents globally.`);
  
  let repairedCount = 0;

  for (const file of canvasFiles) {
     const [content] = await file.download();
     const data = JSON.parse(content.toString('utf8'));
     
     if (!data || !data.nodes) continue;
     
     const nodes = data.nodes;
     let needsUpdate = false;

     for (let i = 0; i < nodes.length; i++) {
         const node = nodes[i];
         if (node.isMain === true && node.type === 'markdown') {
             console.log(`[REPAIR] Found corrupted hidden note in Canvas [${data.title}]`);
             nodes[i].isMain = false;
             needsUpdate = true;
             repairedCount++;
         }
     }

     if (needsUpdate) {
         console.log(`-> Un-hiding note. Saving back to GCS for ${data.title}...`);
         await file.save(JSON.stringify(data, null, 2), { contentType: 'application/json' });
     }
  }

  console.log(`\n🎉 GCS PATCH COMPLETE. Successfully recovered ${repairedCount} hidden UI notes entirely invisibly!`);
}

repairGCS().catch(console.error);
