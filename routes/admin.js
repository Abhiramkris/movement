const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { requireAdmin } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { body, validationResult } = require('express-validator');
const { normalizePhone } = require('../utils/helpers');

// Login
router.get('/login', (req, res) => {
    res.render('admin/login');
});

router.post('/login',
    authLimiter,
    [
        body('username').trim().notEmpty().withMessage('Username is required').escape(),
        body('password').trim().notEmpty().withMessage('Password is required')
    ],
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            if (req.xhr || req.headers.accept.indexOf('json') > -1) {
                return res.status(400).json({ errors: errors.array() });
            }
            return res.status(400).send('Validation failed');
        }

        const { username, password } = req.body;

        if (
            username === process.env.ADMIN_USERNAME &&
            password === process.env.ADMIN_PASSWORD
        ) {
            req.session.isAdmin = true;

            const token = jwt.sign(
                { role: 'admin' },
                process.env.JWT_SECRET,
                { expiresIn: '12h' }
            );

            res.cookie('admin_jwt', token, {
                httpOnly: true,
                sameSite: 'strict',
                secure: process.env.NODE_ENV === 'production'
            });

            if (req.xhr || req.headers.accept.indexOf('json') > -1) {
                return res.json({ redirect: '/admin/dashboard' });
            }
            return res.redirect('/admin/dashboard');
        }

        if (req.xhr || req.headers.accept.indexOf('json') > -1) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        res.status(401).send('Invalid credentials. <a href="/admin/login">Try again</a>');
    });

router.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('admin_jwt');
        res.redirect('/admin/login');
    });
});

// Dashboard
router.get('/dashboard', requireAdmin, async (req, res) => {
    const filterDate = req.query.date || '';
    let query = 'SELECT * FROM appointments';
    const queryParams = [];

    if (filterDate) {
        query += ' WHERE date = ?';
        queryParams.push(filterDate);
    }

    try {
        const [results] = await db.query(query, queryParams);
        res.render('admin/dashboard', { appointments: results, filterDate });
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch appointments' });
    }
});

// REST APIs for New Dashboard

// Fetch all appointments (for Calendar & Dashboard)
router.get('/api/appointments', requireAdmin, async (req, res) => {
    try {
        const [pending] = await db.query('SELECT * FROM appointments ORDER BY date ASC, slot ASC');
        const [approved] = await db.query('SELECT * FROM approved_appointments ORDER BY date ASC, slot ASC');

        const pendingWithStatus = pending.map(a => ({ ...a, status: 'pending' }));
        const allAppointments = [...pendingWithStatus, ...approved];

        res.json(allAppointments);
    } catch (err) {
        console.error('Error fetching appointments API:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Patient History by Phone (Trail)
router.get('/api/patient/:phone/history', requireAdmin, async (req, res) => {
    const { phone } = req.params;
    if (!phone) return res.status(400).json({ error: 'Phone number required' });

    try {
        const normalizedPhone = normalizePhone(phone);
        // Fetch all past approved appointments for this phone
        const [visits] = await db.query(
            'SELECT * FROM approved_appointments WHERE phone = ? ORDER BY date DESC',
            [normalizedPhone]
        );
        res.json(visits);
    } catch (err) {
        console.error('Error fetching patient history:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Update Trial Notes / Status
router.post('/api/appointment/:id/notes',
    requireAdmin,
    [
        body('clinical_notes.s').trim().escape().optional({ checkFalsy: true }),
        body('clinical_notes.o').trim().escape().optional({ checkFalsy: true }),
        body('clinical_notes.ap').trim().escape().optional({ checkFalsy: true }),
        body('status').trim().notEmpty().withMessage('Status is required')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { id } = req.params;
        const { clinical_notes, status } = req.body;

        try {
            let updateQuery = 'UPDATE approved_appointments SET ';
            const queryParams = [];
            const updates = [];

            if (clinical_notes && (clinical_notes.s || clinical_notes.o || clinical_notes.ap)) {
                updates.push('clinical_notes = ?');
                queryParams.push(JSON.stringify(clinical_notes));
            }
            if (status) {
                updates.push('status = ?');
                queryParams.push(status);
            }

            if (updates.length === 0) return res.status(400).json({ error: 'No data to update' });

            updateQuery += updates.join(', ') + ' WHERE id = ?';
            queryParams.push(id);

            const [result] = await db.query(updateQuery, queryParams);
            if (result.affectedRows === 0) {
                return res.status(404).json({ error: 'Appointment not found' });
            }

            res.json({ message: 'Record updated successfully' });
        } catch (err) {
            console.error('Error updating appointment notes:', err);
            res.status(500).json({ error: 'Database error' });
        }
    });

// Approve Appointment
router.post('/approve', requireAdmin, async (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Missing appointment ID' });

    try {
        // Move from appointments to approved_appointments
        const [pending] = await db.query('SELECT * FROM appointments WHERE id = ?', [id]);
        if (!pending || pending.length === 0) return res.status(404).json({ error: 'Not found' });

        const appt = pending[0];
        await db.query(
            'INSERT INTO approved_appointments (date, slot, phone, name, address, email, city) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [appt.date, appt.slot, appt.phone, appt.name, appt.address, appt.email, appt.city]
        );
        await db.query('DELETE FROM appointments WHERE id = ?', [id]);

        // Trigger Email (Non-blocking)
        const emailService = require('../utils/email');
        emailService.sendStatusUpdate(appt.email, appt.name, appt.date, appt.slot, 'approved')
            .catch(e => console.error("Email err:", e));

        res.json({ message: 'Approved successfully' });
    } catch (err) {
        console.error('Approve error:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Delete Appointment (Decline)
router.post('/delete', requireAdmin, async (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Missing appointment ID' });

    try {
        const [pending] = await db.query('SELECT * FROM appointments WHERE id = ?', [id]);

        if (pending && pending.length > 0) {
            const appt = pending[0];
            await db.query('DELETE FROM appointments WHERE id = ?', [id]);
            await db.query('DELETE FROM slots WHERE date = ? AND slot = ?', [appt.date, appt.slot]);

            // Trigger Email (Non-blocking)
            const emailService = require('../utils/email');
            emailService.sendStatusUpdate(appt.email, appt.name, appt.date, appt.slot, 'cancelled')
                .catch(e => console.error("Email err:", e));
        }
        res.json({ message: 'Deleted successfully' });
    } catch (err) {
        console.error('Delete error:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Call Requests
router.get('/call', requireAdmin, async (req, res) => {
    try {
        const [results] = await db.query('SELECT * FROM call_requests ORDER BY id DESC');
        res.render('admin/caller', { callRequests: results });
    } catch (err) {
        res.status(500).send('Database error');
    }
});

// Delete Call Request
router.post('/call/delete/:id', requireAdmin, async (req, res) => {
    try {
        await db.query('DELETE FROM call_requests WHERE id = ?', [req.params.id]);
        res.redirect('/admin/call');
    } catch (err) {
        console.error('Error deleting call request:', err);
        res.status(500).send('Database error');
    }
});

module.exports = router;
