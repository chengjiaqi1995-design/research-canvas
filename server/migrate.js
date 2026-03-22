import crypto from 'crypto';
import { Storage } from '@google-cloud/storage';

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'gen-lang-client-0634831802';
const UPLOAD_BUCKET = `${PROJECT_ID}-uploads-asia`;
const storage = new Storage();
const bucket = storage.bucket(UPLOAD_BUCKET);

async function runMigration() {
    console.log(`Starting migration on bucket: ${UPLOAD_BUCKET}`);
    try {
        const [exists] = await bucket.exists();
        if (!exists) {
            console.log('Bucket does not exist.');
            return;
        }
    } catch (e) {
        console.error('Bucket check failed. Are you authenticated with Google Cloud?', e.message);
        return;
    }

    const [files] = await bucket.getFiles({ matchGlob: '*/workspaces-index.json' });
    
    if (files.length === 0) {
        console.log('No users found to migrate.');
        return;
    }

    for (const file of files) {
        const userId = file.name.split('/')[0];
        console.log(`\nMigrating user: ${userId}`);
        
        // 1. Read Workspaces
        const [wsContent] = await file.download();
        const workspaces = JSON.parse(wsContent.toString());
        
        // 2. Read Canvases
        const canvasFile = bucket.file(`${userId}/canvases-index.json`);
        let canvases = [];
        if ((await canvasFile.exists())[0]) {
            const [cContent] = await canvasFile.download();
            canvases = JSON.parse(cContent.toString());
        }
        
        const subFolders = workspaces.filter(w => w.parentId);
        if (subFolders.length === 0) {
            console.log(`  No sub-folders found for ${userId}. Skipping.`);
            continue;
        }
        
        console.log(`  Found ${subFolders.length} sub-folders to migrate.`);
        
        // 3. Migrate Subfolders to Canvases
        const newWorkspaces = workspaces.filter(w => !w.parentId);
        let newCanvases = [...canvases];
        
        for (const sub of subFolders) {
            const parentId = sub.parentId;
            
            // Check if there are any canvases inside this sub-folder
            const childrenCanvases = canvases.filter(c => c.workspaceId === sub.id);
            
            if (childrenCanvases.length === 0) {
                // Empty sub-folder: maybe just create an empty canvas
                const newCanvasId = `canvas-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
                console.log(`  Sub-folder "${sub.name}" is empty. Creating an empty Canvas for it.`);
                newCanvases.push({
                    id: newCanvasId, 
                    title: sub.name,
                    workspaceId: parentId, // Move up to Industry Folder
                    createdAt: sub.createdAt || Date.now(),
                    updatedAt: sub.updatedAt || Date.now(),
                    nodeCount: 0
                });
            } else if (childrenCanvases.length === 1) {
                // Has 1 canvas - Move it up and rename it to Subfolder name
                const child = childrenCanvases[0];
                console.log(`  Sub-folder "${sub.name}" has 1 canvas. Moving up and renaming to "${sub.name}".`);
                const childIndex = newCanvases.findIndex(c => c.id === child.id);
                if (childIndex >= 0) {
                    newCanvases[childIndex].workspaceId = parentId;
                    newCanvases[childIndex].title = sub.name; 
                }
            } else {
                // Has multiple canvases
                console.log(`  Sub-folder "${sub.name}" has ${childrenCanvases.length} canvases. Moving them all up.`);
                for (const child of childrenCanvases) {
                    const childIndex = newCanvases.findIndex(c => c.id === child.id);
                    if (childIndex >= 0) {
                        newCanvases[childIndex].workspaceId = parentId;
                        newCanvases[childIndex].title = `${sub.name} - ${child.title}`;
                    }
                }
            }
        }
        
        // 4. Save back
        console.log(`  Saving updated workspaces (${newWorkspaces.length}) and canvases (${newCanvases.length})`);
        await file.save(JSON.stringify(newWorkspaces), { contentType: 'application/json' });
        await canvasFile.save(JSON.stringify(newCanvases), { contentType: 'application/json' });
        
        // Create a backup just in case
        await bucket.file(`${userId}/backup-workspaces-index-${Date.now()}.json`).save(wsContent, { contentType: 'application/json' });
        if (canvases.length > 0) {
           await bucket.file(`${userId}/backup-canvases-index-${Date.now()}.json`).save(JSON.stringify(canvases), { contentType: 'application/json' });
        }
    }
    console.log('\nMigration complete.');
}

runMigration().catch(console.error);
