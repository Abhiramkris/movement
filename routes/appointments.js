const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { requireAdmin } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');
const emailService = require('../utils/email');

// Add Appointment Page
router.get('/add-appointment', (req, res) => {
    if (!req.session.otp_verified) return res.redirect('/');
    res.render('appointment');
});

router.post(
    '/add-appointment',
    [
        body('name').trim().notEmpty().withMessage('Name is required').escape(),
        body('address').trim().notEmpty().withMessage('Address is required').escape(),
        body('email').trim().isEmail().withMessage('Invalid email address').normalizeEmail()
    ],
    async (req, res) => {
        if (!req.session.otp_verified) return res.status(401).json({ error: 'Forbidden' });

        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { name, address, email } = req.body;
        const { date, slot, phone, city } = req.session;

        try {
            await db.query(
                'INSERT INTO appointments (name, address, email, phone, city, date, slot) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [name, address, email, phone, city, date, slot]
            );

            await db.query(
                `INSERT INTO customers (name, address, email, phone, city) VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE name=VALUES(name), address=VALUES(address), email=VALUES(email), city=VALUES(city)`,
                [name, address, email, phone, city]
            );

            await db.query('INSERT INTO slots (date, slot) VALUES (?, ?)', [date, slot]);

            // Try sending emails asynchronously (non-blocking for the user)
            const appointmentData = { name, email, phone, address, city, date, slot };
            Promise.all([
                emailService.sendBookingConfirmation(email, name, date, slot),
                emailService.sendAdminBookingAlert(appointmentData)
            ]).catch(e => console.error("Non-critical email error:", e));

            // Notify via global IO if needed, or simple redirect
            req.session.destroy(() => res.json({ redirect: '/added' }));
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Database error' });
        }
    }
);

router.get('/added', (req, res) => res.render('add'));

module.exports = router;
