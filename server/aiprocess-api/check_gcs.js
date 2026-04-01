const { Storage } = require('@google-cloud/storage');
const storage = new Storage({ projectId: 'ainotebook-1baa3', keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS });
const bucket = storage.bucket('ainotebook');
async function check() {
  const [files] = await bucket.getFiles({ prefix: '1775033981514' });
  console.log(files.map(f => f.name));
}
check().catch(console.error);
