const express = require('express');
const cors = require('cors');
const db = require('./db');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// خدمة الملفات الثابتة (index.html و viewer.html)
app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
// أضف مساراً لفتح viewer.html
app.get('/view', (req, res) => {
    res.sendFile(path.join(__dirname, 'viewer.html'));
});

// ==========================================
// 1. إدارة الموظفين واليومية (Daily Records)
// ==========================================
app.get('/api/employees', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM daily_records ORDER BY date DESC');
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/employees', async (req, res) => {
    console.log("البيانات المستلمة في السيرفر:", req.body);
    if (!req.body || Object.keys(req.body).length === 0) {
        return res.status(400).json({ success: false, message: 'لم يتم استلام أي بيانات' });
    }
    // التعديل: استقبال dedReason
    const { id, name, date, start, end, base, extra, loan, ded, dedReason, note } = req.body;
    try {
        await db.query(`
            INSERT INTO daily_records 
            (id, name, date, start_time, end_time, base_hours, extra_hours, loan, deduction, deduction_reason, note) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [id, name, date, start, end, base, extra, loan, ded, dedReason, note]);
        res.json({ success: true });
    } catch (err) {
        console.error("خطأ في قاعدة البيانات:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/employees/:id', async (req, res) => {
    // التعديل: استقبال dedReason
    const { name, date, start, end, base, extra, loan, ded, dedReason, note } = req.body;
    try {
        await db.query(`
            UPDATE daily_records 
            SET name=?, date=?, start_time=?, end_time=?, base_hours=?, extra_hours=?, loan=?, deduction=?, deduction_reason=?, note=? 
            WHERE id=?
        `, [name, date, start, end, base, extra, loan, ded, dedReason, note, req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/employees/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM daily_records WHERE id=?', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// 2. نظام الأرشيف الشهري (Monthly Archive)
// ==========================================
app.get('/api/archive/check', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT MIN(date) as oldest_date FROM daily_records');
        if (!rows[0].oldest_date) return res.json({ canArchive: false, message: 'لا توجد بيانات للأرشفة' });
        
        const oldestDate = new Date(rows[0].oldest_date);
        const currentDate = new Date();
        
        const isOldMonth = (oldestDate.getFullYear() < currentDate.getFullYear()) || 
                           (oldestDate.getFullYear() === currentDate.getFullYear() && oldestDate.getMonth() < currentDate.getMonth());
        
        if (isOldMonth) {
            const monthToArchive = `${oldestDate.getFullYear()}-${String(oldestDate.getMonth() + 1).padStart(2, '0')}`;
            res.json({ canArchive: true, monthToArchive });
        } else {
            res.json({ canArchive: false, message: 'لم يحن وقت الأرشفة بعد' });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/archive/migrate', async (req, res) => {
    const { targetMonth } = req.body;
    try {
        // التعديل: ترحيل عمود deduction_reason أيضاً
        await db.query(`
            INSERT INTO monthly_archive 
            (id, archive_month, execution_date, name, date, start_time, end_time, base_hours, extra_hours, loan, deduction, deduction_reason, note)
            SELECT id, ?, NOW(), name, date, start_time, end_time, base_hours, extra_hours, loan, deduction, deduction_reason, note 
            FROM daily_records 
            WHERE DATE_FORMAT(date, '%Y-%m') = ?
        `, [targetMonth, targetMonth]);
        
        await db.query(`DELETE FROM daily_records WHERE DATE_FORMAT(date, '%Y-%m') = ?`, [targetMonth]);
        res.json({ success: true, message: 'تم الترحيل بنجاح' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/archive/all', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM monthly_archive ORDER BY date DESC');
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// 3. إدارة المخزون (Inventory)
// ==========================================
app.get('/api/inventory', async (req, res) => {
    try {
        const [charcoal] = await db.query('SELECT * FROM inventory_charcoal');
        const [carton] = await db.query('SELECT * FROM inventory_carton');
        const [shell] = await db.query('SELECT * FROM inventory_shell');
        res.json({ charcoal, carton, shell });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/inventory/:type', async (req, res) => {
    const { type } = req.params;
    try {
        if (type === 'charcoal') {
            await db.query('INSERT INTO inventory_charcoal (type, carton, count, weight, receiver) VALUES (?, ?, ?, ?, ?)', 
                [req.body.type, req.body.carton, req.body.count, req.body.weight, req.body.receiver]);
        } 
        else if (type === 'carton') {
            const { type: cType, count, receiver, sender, date } = req.body;
            await db.query('INSERT INTO inventory_carton (type, count, receiver, sender, date) VALUES (?, ?, ?, ?, ?)', 
                [cType, count, receiver, sender, date]);
        } 
        else if (type === 'shell') {
            const { type: sType, weight, count, receiver, sender, date } = req.body;
            await db.query('INSERT INTO inventory_shell (type, weight, count, receiver, sender, date) VALUES (?, ?, ?, ?, ?, ?)', 
                [sType, weight, count, receiver, sender, date]);
        }
        res.json({ success: true });
    } catch (err) { 
        console.error(err);
        res.status(500).json({ error: err.message }); 
    }
});

app.delete('/api/inventory/:type/:id', async (req, res) => {
    try {
        await db.query(`DELETE FROM inventory_${req.params.type} WHERE id=?`, [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// تشغيل السيرفر
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`السيرفر يعمل على المنفذ ${PORT}`));