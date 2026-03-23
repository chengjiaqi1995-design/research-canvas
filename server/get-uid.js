const { Storage } = require('@google-cloud/storage');
async function run() {
  const storage = new Storage();
  const [files] = await storage.bucket('gen-lang-client-0634831802-uploads-asia').getFiles({ prefix: '' });
  const ids = new Set();
  files.forEach(f => {
     const parts = f.name.split('/');
     if (parts.length > 1) {
         ids.add(parts[0]);
     }
  });
  console.log("Found User IDs in database bucket:");
  console.log([...ids]);
}
run().catch(console.error);
