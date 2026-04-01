const jwt = require('jsonwebtoken');

const PROD_JWT_SECRET = '34794b4f4a07d9f602e1b0ee64077607ebd547fae450a6496fdaac8e23ee4943';
// 104921709359061938941 was the userId locally.
const token = jwt.sign({ userId: '104921709359061938941' }, PROD_JWT_SECRET);

fetch('https://research-canvas-api-30350443416.asia-southeast1.run.app/api/transcriptions?limit=3', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
})
.then(r => r.json())
.then(data => {
  if (data.data && data.data.items) {
    console.log("Transcriptions:");
    data.data.items.slice(0, 3).forEach(t => console.log(t.fileName, t.industry));
  } else {
    console.log("Failed:", data);
  }
})
.catch(console.error);
