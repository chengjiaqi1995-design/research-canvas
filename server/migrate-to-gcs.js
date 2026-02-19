/**
 * Migration Script: Firestore → Google Cloud Storage
 * 
 * Reads all data from Firestore and writes it to GCS in the new format.
 * Does NOT delete any Firestore data — that's a manual step after verification.
 * 
 * Usage:
 *   node migrate-to-gcs.js
 */

import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';

const firestore = new Firestore();
const storage = new Storage();

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'gen-lang-client-0634831802';
const BUCKET_NAME = `${PROJECT_ID}-uploads`;

async function writeJSON(bucket, path, data) {
    const file = bucket.file(path);
    await file.save(JSON.stringify(data), {
        contentType: 'application/json',
        resumable: false,
    });
}

async function migrate() {
    const bucket = storage.bucket(BUCKET_NAME);

    const [exists] = await bucket.exists();
    if (!exists) {
        console.error(`Bucket ${BUCKET_NAME} does not exist!`);
        process.exit(1);
    }

    console.log(`Migrating from Firestore to GCS bucket: ${BUCKET_NAME}\n`);

    // Discover user IDs via collectionGroup queries
    // (Firestore parent docs may not exist as standalone documents)
    const userIds = new Set();

    const wsSnap = await firestore.collectionGroup('workspaces').get();
    wsSnap.docs.forEach(doc => {
        // path: users/{userId}/workspaces/{wsId}
        const parts = doc.ref.path.split('/');
        if (parts[0] === 'users') userIds.add(parts[1]);
    });

    const canvasSnap = await firestore.collectionGroup('canvases').get();
    canvasSnap.docs.forEach(doc => {
        const parts = doc.ref.path.split('/');
        if (parts[0] === 'users') userIds.add(parts[1]);
    });

    const settingsSnap = await firestore.collectionGroup('settings').get();
    settingsSnap.docs.forEach(doc => {
        const parts = doc.ref.path.split('/');
        if (parts[0] === 'users') userIds.add(parts[1]);
    });

    console.log(`Found ${userIds.size} user(s): ${[...userIds].join(', ')}\n`);

    let totalWorkspaces = 0;
    let totalCanvases = 0;
    let totalNodes = 0;
    let totalSettings = 0;

    for (const userId of userIds) {
        const userRef = firestore.collection('users').doc(userId);
        console.log(`── User: ${userId}`);

        // 1. Migrate Workspaces
        const wsSnapshot = await userRef.collection('workspaces').get();
        console.log(`   Workspaces: ${wsSnapshot.size}`);
        for (const wsDoc of wsSnapshot.docs) {
            const workspace = wsDoc.data();
            await writeJSON(bucket, `${userId}/workspaces/${wsDoc.id}.json`, workspace);
            totalWorkspaces++;
            console.log(`     ✓ ${workspace.name || wsDoc.id}`);
        }

        // 2. Migrate Canvases
        const canvasSnapshot = await userRef.collection('canvases').get();
        console.log(`   Canvases: ${canvasSnapshot.size}`);
        for (const canvasDoc of canvasSnapshot.docs) {
            const canvas = canvasDoc.data();

            // Offload node data to separate GCS files
            let nodeCount = 0;
            if (canvas.nodes && Array.isArray(canvas.nodes)) {
                for (const node of canvas.nodes) {
                    if (node.data) {
                        const gcsPath = `${userId}/canvas-data/${canvasDoc.id}/${node.id}.json`;
                        await writeJSON(bucket, gcsPath, node.data);
                        node._dataRef = gcsPath;
                        delete node.data;
                        nodeCount++;
                        totalNodes++;
                    }
                }
            }

            await writeJSON(bucket, `${userId}/canvases/${canvasDoc.id}.json`, canvas);
            totalCanvases++;
            console.log(`     ✓ ${canvas.title || canvasDoc.id} (${nodeCount} nodes)`);
        }

        // 3. Migrate Settings
        const settingsSnapshot = await userRef.collection('settings').get();
        for (const settingsDoc of settingsSnapshot.docs) {
            const settings = settingsDoc.data();
            await writeJSON(bucket, `${userId}/settings/${settingsDoc.id}.json`, settings);
            totalSettings++;
        }
        console.log(`   Settings: ${settingsSnapshot.size}`);
        console.log('');
    }

    console.log('═══════════════════════════════════════');
    console.log('Migration complete!');
    console.log(`  Users:      ${userIds.size}`);
    console.log(`  Workspaces: ${totalWorkspaces}`);
    console.log(`  Canvases:   ${totalCanvases}`);
    console.log(`  Nodes:      ${totalNodes}`);
    console.log(`  Settings:   ${totalSettings}`);
    console.log('');
    console.log('⚠️  Firestore data has NOT been deleted.');
    console.log('    Verify everything works, then manually clean up.');
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
