const jwt = require('jsonwebtoken');

const PROD_JWT_SECRET = process.env.JWT_SECRET;
if (!PROD_JWT_SECRET) {
  throw new Error('JWT_SECRET is required');
}
const token = jwt.sign({ userId: '104921709359061938941' }, PROD_JWT_SECRET);

fetch('https://research-canvas-api-iwuz3k44oa-as.a.run.app/api/transcriptions?limit=3', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
})
.then(r => r.json())
.then(data => {
  if (data.data && data.data.items) {
    console.log("Transcriptions:");
    data.data.items.slice(0, 3).forEach(t => console.log(t.fileName, "|", t.industry));
  } else {
    console.log("Failed:", data);
  }
})
.catch(console.error);
