const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const cors = require('cors');
const path = require('path');
const app = express();

// Middleware
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// LOCAL MongoDB bağlantısı
// YENİ
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/license_db';
const PORT = process.env.PORT || 3000;

console.log('🔄 MongoDB\'ye bağlanıyor:', MONGODB_URI);

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('✅ MongoDB bağlantısı başarılı!');
}).catch(err => {
    console.error('❌ MongoDB bağlantı hatası!', err.message);
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

// Anahtar oluşturma
function generateLicenseKey() {
    return 'WITCH-' + crypto.randomBytes(4).toString('hex').toUpperCase() + 
           '-' + crypto.randomBytes(4).toString('hex').toUpperCase() + 
           '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

// Yeni lisans oluşturma
app.post('/api/generate-license', async (req, res) => {
    try {
        const { days, maxUses } = req.body;
        
        if (!days) {
            return res.status(400).json({ error: 'Gün sayısı gerekli' });
        }

        const key = generateLicenseKey();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + days);

        const license = new License({
            key,
            expiresAt,
            maxUses: maxUses || 1
        });

        await license.save();
        
        res.json({
            success: true,
            key,
            expiresAt,
            days,
            message: `${days} günlük lisans oluşturuldu`
        });
    } catch (error) {
        console.error('❌ Hata:', error);
        res.status(500).json({ error: error.message });
    }
});

// TEKLİ LİSANS SİLME
app.delete('/api/license/:key', async (req, res) => {
    try {
        const { key } = req.params;
        
        const result = await License.findOneAndDelete({ key });
        
        if (!result) {
            return res.status(404).json({ error: 'Lisans bulunamadı' });
        }
        
        res.json({ 
            success: true, 
            message: 'Lisans başarıyla silindi',
            deletedKey: key 
        });
    } catch (error) {
        console.error('❌ Silme hatası:', error);
        res.status(500).json({ error: error.message });
    }
});

// TOPLU LİSANS SİLME (Tümünü sil)
app.delete('/api/licenses', async (req, res) => {
    try {
        const { status } = req.query; // ?status=expired veya ?status=all
        
        let filter = {};
        
        if (status === 'expired') {
            // Süresi dolmuş lisansları bul
            filter = {
                expiresAt: { $lt: new Date() }
            };
        }
        
        const result = await License.deleteMany(filter);
        
        res.json({ 
            success: true, 
            message: `${result.deletedCount} lisans silindi`,
            deletedCount: result.deletedCount
        });
    } catch (error) {
        console.error('❌ Toplu silme hatası:', error);
        res.status(500).json({ error: error.message });
    }
});

// LİSANS PASİF YAP (Silmeden devre dışı bırak)
app.patch('/api/license/:key/deactivate', async (req, res) => {
    try {
        const { key } = req.params;
        
        const license = await License.findOneAndUpdate(
            { key },
            { isActive: false },
            { new: true }
        );
        
        if (!license) {
            return res.status(404).json({ error: 'Lisans bulunamadı' });
        }
        
        res.json({ 
            success: true, 
            message: 'Lisans pasifleştirildi',
            license 
        });
    } catch (error) {
        console.error('❌ Pasifleştirme hatası:', error);
        res.status(500).json({ error: error.message });
    }
});

// LİSANS AKTİF YAP
app.patch('/api/license/:key/activate', async (req, res) => {
    try {
        const { key } = req.params;
        
        const license = await License.findOneAndUpdate(
            { key },
            { isActive: true },
            { new: true }
        );
        
        if (!license) {
            return res.status(404).json({ error: 'Lisans bulunamadı' });
        }
        
        res.json({ 
            success: true, 
            message: 'Lisans aktifleştirildi',
            license 
        });
    } catch (error) {
        console.error('❌ Aktifleştirme hatası:', error);
        res.status(500).json({ error: error.message });
    }
});

// Lisans doğrulama
app.post('/api/verify-license', async (req, res) => {
    try {
        const { key, hardwareId } = req.body;

        const license = await License.findOne({ key });

        if (!license) {
            return res.json({ valid: false, reason: 'Lisans bulunamadı' });
        }

        if (!license.isActive) {
            return res.json({ valid: false, reason: 'Lisans pasif' });
        }

        if (new Date() > license.expiresAt) {
            license.isActive = false;
            await license.save();
            return res.json({ valid: false, reason: 'Lisans süresi doldu' });
        }

        if (license.currentUses >= license.maxUses) {
            return res.json({ valid: false, reason: 'Maksimum kullanım sayısına ulaşıldı' });
        }

        license.currentUses += 1;
        license.lastUsed = new Date();
        license.usedBy = hardwareId || 'unknown';
        await license.save();

        res.json({ 
            valid: true, 
            expiresAt: license.expiresAt,
            remainingUses: license.maxUses - license.currentUses
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Tüm lisansları getir
app.get('/api/licenses', async (req, res) => {
    try {
        const licenses = await License.find().sort({ createdAt: -1 });
        res.json(licenses);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Test endpoint'i
app.get('/api/test', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Sunucu çalışıyor',
        mongodb: mongoose.connection.readyState === 1 ? 'bağlı' : 'bağlı değil'
    });
});

// Ana sayfa
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});


app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Lisans sunucusu başlatıldı!`);
    console.log(`📱 Adres: http://localhost:${PORT}`);
    console.log(`📁 Admin panel: http://localhost:${PORT}`);
});