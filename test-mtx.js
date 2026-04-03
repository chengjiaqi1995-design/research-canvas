import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  console.log('No data dir:', DATA_DIR);
  process.exit(1);
}

const users = fs.readdirSync(DATA_DIR);
for (const user of users) {
  const userPath = path.join(DATA_DIR, user);
  if (!fs.statSync(userPath).isDirectory()) continue;
  
  const canvasesPath = path.join(userPath, 'canvases');
  if (!fs.existsSync(canvasesPath)) continue;
  
  const files = fs.readdirSync(canvasesPath);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const content = JSON.parse(fs.readFileSync(path.join(canvasesPath, file), 'utf8'));
    if (content.title && content.title.includes('MTX GR')) {
      console.log('FOUND:', content.id);
      console.log('TITLE:', content.title);
      console.log('Total nodes:', content.nodes.length);
      console.log('Main nodes:', content.nodes.filter(n => n.isMain).length);
      console.log('Non-main nodes (files):', content.nodes.filter(n => !n.isMain).length);
      console.log('Full nodes:');
      console.log(JSON.stringify(content.nodes, null, 2));
    }
  }
}
