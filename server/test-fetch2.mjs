import fetch from 'node-fetch';

async function run() {
  try {
    const res = await fetch('http://localhost:8080/api/sync/fetch-notes');
    const data = await res.json();
    const items = data.data?.items || [];
    
    console.log(`FETCHED ${items.length} TOTAL NOTES.`);
    
    // Search for 欧陆通 and 潍柴
    const targets = items.filter(n => 
      (n.fileName && (n.fileName.includes("欧陆通") || n.fileName.includes("潍柴"))) ||
      (n.topic && (n.topic.includes("欧陆通") || n.topic.includes("潍柴")))
    );
    
    console.log(`FOUND ${targets.length} MATCHING NOTES.`);
    
    targets.forEach((n, idx) => {
      console.log(`\n--- NOTE ${idx + 1} ---`);
      console.log("fileName:", n.fileName);
      console.log("type:", n.type);
      console.log("tags:", n.tags);
      console.log("organization:", n.organization);
      console.log("companies:", n.companies);
      console.log("metadata:", JSON.stringify(n.metadata, null, 2));
    });
    
  } catch (e) {
    console.error(e);
  }
}
run();
