// server.js
const express = require('express');
const admin = require('firebase-admin');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

// --- CONFIGURATION ---
const PORT = 3000;
// This is the password you must enter on the admin panel to perform actions.
// The "Ad Link" feature will lead people to find *this* key.
const ADMIN_ACCESS_KEY = "123"; 

// --- FIREBASE SETUP ---
// Make sure you have serviceAccountKey.json in the same directory
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  // Replace with your actual storage bucket name from Firebase Console -> Storage
  storageBucket: "YOUR_FIREBASE_PROJECT_ID.appspot.com" 
});

const db = admin.firestore();
const bucket = admin.storage().bucket();
const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(cors());

// --- MIDDLEWARE FOR ADMIN AUTH ---
const checkAdminKey = (req, res, next) => {
    const providedKey = req.headers['x-admin-key'];
    if (providedKey !== ADMIN_ACCESS_KEY) {
        return res.status(403).json({ error: 'Invalid Access Key' });
    }
    next();
};

// --- SERVE HTML FILES ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '/index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '/admin.html'));
});


// --- API ROUTES ---

// GET Public Config (To get the Ad Link)
app.get('/api/config', async (req, res) => {
    try {
        const doc = await db.collection('settings').doc('main').get();
        if (!doc.exists) {
             // Default if not set yet
            return res.json({ adLink: 'https://google.com' });
        }
        res.json(doc.data());
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST Set Config (Admin only - sets the ad link)
app.post('/api/admin/config', checkAdminKey, async (req, res) => {
    try {
        const { adLink } = req.body;
        await db.collection('settings').doc('main').set({ adLink }, { merge: true });
        res.json({ success: true, message: "Ad link updated successfully." });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST Add Emote (Admin only - Uploads to Storage & adds to Firestore)
app.post('/api/admin/addemote', checkAdminKey, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).send('No file uploaded.');

        const blob = bucket.file(`emotes/${Date.now()}_${req.file.originalname}`);
        const blobStream = blob.createWriteStream({
            metadata: { contentType: req.file.mimetype }
        });

        blobStream.on('error', err => res.status(500).json({ error: err.message }));

        blobStream.on('finish', async () => {
            // Make the file publicly accessible
            await blob.makePublic();
            const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;

            // Add to Firestore
            const newDocRef = db.collection('emotes').doc();
            await newDocRef.set({
                id: newDocRef.id,
                name: req.body.name || 'Unnamed Emote',
                url: publicUrl,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

            res.json({ success: true, url: publicUrl });
        });

        blobStream.end(req.file.buffer);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE Emote (Admin only)
app.delete('/api/admin/emote/:id', checkAdminKey, async (req, res) => {
    try {
        const emoteId = req.params.id;
        const docRef = db.collection('emotes').doc(emoteId);
        const doc = await docRef.get();

        if (!doc.exists) return res.status(404).json({ error: 'Emote not found' });

        const emoteData = doc.data();

        // 1. Delete from Storage using the URL to extract path
        const filePath = emoteData.url.split(`${bucket.name}/`)[1];
        if (filePath) {
             await bucket.file(filePath).delete().catch(e => console.log("Storage delete error (might not exist):", e.message));
        }
       
        // 2. Delete from Firestore
        await docRef.delete();

        res.json({ success: true, message: 'Emote deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


app.listen(PORT, () => {
    console.log(`Ruby Emotes Server running on http://localhost:${PORT}`);
    console.log(`Admin Key is currently set to: ${ADMIN_ACCESS_KEY}`);
});