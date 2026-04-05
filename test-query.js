const fs = require('fs');
try {
  const dbStr = fs.readFileSync('db_data.json', 'utf8');
  const db = JSON.parse(dbStr);
  console.log("Workspaces:");
  db.workspaces.forEach(w => {
    if (w.name.includes("煤") || w.industryCategory === "资源") {
      console.log(w);
    }
  });
  console.log("Categories:");
  console.log(db.industryCategories);
} catch(e) {
  console.log("Unable to read db, checking API endpoint or other storage if possible.", e);
}
