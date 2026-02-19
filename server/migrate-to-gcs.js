/**
 * Migration Script: Firestore → Google Cloud Storage
 * 
 * This script reads all data from Firestore and writes it to GCS in the new format.
 * It does NOT delete any Firestore data — that's a manual step after verification.
 * 
 * Usage:
 *   node migrate-to-gcs.js
 * 
 * Prerequisites:
 *   - Must be run with GCP credentials (e.g., `gcloud auth application-default login`)
 *   - Firestore and GCS must be accessible
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

    // Check bucket exists
    const [exists] = await bucket.exists();
    if (!exists) {
        console.error(`Bucket ${BUCKET_NAME} does not exist!`);
        process.exit(1);
    }

    console.log(`Migrating from Firestore to GCS bucket: ${BUCKET_NAME}\n`);

    // Get all users
    const usersSnapshot = await firestore.collection('users').get();
    console.log(`Found ${usersSnapshot.size} user(s)\n`);

    let totalWorkspaces = 0;
    let totalCanvases = 0;
    let totalNodes = 0;
    let totalSettings = 0;

    for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id;
        console.log(`── User: ${userId}`);

        // 1. Migrate Workspaces
        const wsSnapshot = await userDoc.ref.collection('workspaces').get();
        console.log(`   Workspaces: ${wsSnapshot.size}`);
        for (const wsDoc of wsSnapshot.docs) {
            const workspace = wsDoc.data();
            await writeJSON(bucket, `${userId}/workspaces/${wsDoc.id}.json`, workspace);
            totalWorkspaces++;
        }

        // 2. Migrate Canvases
        const canvasSnapshot = await userDoc.ref.collection('canvases').get();
        console.log(`   Canvases: ${canvasSnapshot.size}`);
        for (const canvasDoc of canvasSnapshot.docs) {
            const canvas = canvasDoc.data();

            // Offload node data to separate GCS files
            if (canvas.nodes && Array.isArray(canvas.nodes)) {
                for (const node of canvas.nodes) {
                    if (node.data) {
                        const gcsPath = `${userId}/canvas-data/${canvasDoc.id}/${node.id}.json`;
                        await writeJSON(bucket, gcsPath, node.data);
                        node._dataRef = gcsPath;
                        delete node.data;
                        totalNodes++;
                    }
                }
            }

            // Save canvas metadata (without node data)
            await writeJSON(bucket, `${userId}/canvases/${canvasDoc.id}.json`, canvas);
            totalCanvases++;
        }

        // 3. Migrate Settings
        const settingsSnapshot = await userDoc.ref.collection('settings').get();
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
    console.log(`  Users:      ${usersSnapshot.size}`);
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
