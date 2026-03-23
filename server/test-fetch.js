const fetch = require('node-fetch');
async function run() {
  const res = await fetch('http://localhost:8080/api/sync/fetch-notes');
  const data = await res.json();
  console.log("TOTAL NOTES FETCHED:", data.data?.items?.length);
  const v = data.data?.items?.filter(n => n.fileName && (n.fileName.includes("英维克") || n.fileName.includes("科士达")));
  console.log("MATCHING NOTES:", v?.map(n => n.fileName));
}
run();
