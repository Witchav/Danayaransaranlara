const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();

// Middleware
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// ================== UPLOAD SYSTEM ==================
const uploadDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const id = crypto.randomUUID();
        cb(null, id + ".zip");
    }
});

const upload = multer({ storage });

// UPLOAD ENDPOINT
app.post("/upload", upload.single("file"), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "no file" });
    }

    const fileName = req.file.filename;

    res.json({
        success: true,
        url: `https://witchlicense-production.up.railway.app/download/${fileName}`
    });
});

// DOWNLOAD ENDPOINT
app.get("/download/:file", (req, res) => {
    const filePath = path.join(uploadDir, req.params.file);

    if (!fs.existsSync(filePath)) {
        return res.status(404).send("Not found");
    }

    res.download(filePath);
});

// AUTO DELETE (1 saat sonra sil)
setInterval(() => {
    const files = fs.readdirSync(uploadDir);

    files.forEach(file => {
        const filePath = path.join(uploadDir, file);
        const stats = fs.statSync(filePath);

        const age = Date.now() - stats.mtimeMs;

        if (age > 60 * 60 * 1000) {
            fs.unlinkSync(filePath);
        }
    });
}, 10 * 60 * 1000);

// ================== NORMAL SİSTEM ==================

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/license_db';
const PORT = process.env.PORT || 3000;

mongoose.connect(MONGODB_URI).then(() => {
    console.log('✅ MongoDB bağlantısı başarılı!');
}).catch(err => {
    console.error('❌ MongoDB hata!', err.message);
});

// Lisans şeması
const licenseSchema = new mongoose.Schema({
    key: { type: String, unique: true, required: true },
    expiresAt: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    lastUsed: { type: Date },
    usedBy: { type: String },
    maxUses: { type: Number, default: 1 },
    currentUses: { type: Number, default: 0 }
});

const License = mongoose.model('License', licenseSchema);

// Key üret
function generateLicenseKey() {
    return 'WITCH-' + crypto.randomBytes(4).toString('hex').toUpperCase() +
           '-' + crypto.randomBytes(4).toString('hex').toUpperCase() +
           '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

// LOGIN
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'witch2024';

    if (password === ADMIN_PASSWORD) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false });
    }
});

// LICENSE CREATE
app.post('/api/generate-license', async (req, res) => {
    try {
        const { days, maxUses } = req.body;

        const key = generateLicenseKey();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + days);

        const license = new License({
            key,
            expiresAt,
            maxUses: maxUses || 1
        });

        await license.save();

        res.json({ success: true, key, expiresAt });

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// VERIFY
app.post('/api/verify-license', async (req, res) => {
    const { key } = req.body;
    const license = await License.findOne({ key });

    if (!license) return res.json({ valid: false });

    if (new Date() > license.expiresAt) {
        return res.json({ valid: false });
    }

    res.json({ valid: true });
});

// TEST
app.get('/api/test', (req, res) => {
    res.json({ status: 'OK' });
});

// ANA SAYFA
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server çalışıyor: ${PORT}`);
});
