const express = require('express');
const router = express.Router();
const path = require('path');
const { body, validationResult } = require('express-validator');
const db = require('../config/db');
const client = require('../config/twilio');
const { otpLimiter } = require('../middleware/rateLimiter');
const fs = require('fs');

// Load How Help Data
const getHowHelpData = () => {
    try {
        const rawData = fs.readFileSync(path.join(__dirname, '../data/howhelp.json'));
        return JSON.parse(rawData);
    } catch (err) {
        console.error('Error loading howhelp data:', err);
        return {};
    }
};

// Load Services Data
const getServicesData = () => {
    try {
        const rawData = fs.readFileSync(path.join(__dirname, '../data/services.json'));
        return JSON.parse(rawData);
    } catch (err) {
        console.error('Error loading services data:', err);
        return [];
    }
};

router.get('/', (req, res) => {
    res.render('index');
});

// How We Help Section
router.get('/howhelp/index', (req, res) => {
    res.render('howhelp/index1');
});

router.get('/howhelp/:slug', (req, res) => {
    const data = getHowHelpData();
    const page = data[req.params.slug];

    if (!page) {
        return res.status(404).render('error', { message: 'Page not found' });
    }

    res.render('howhelp/template', {
        page,
        allPages: Object.values(data)
    });
});

// Check Slot Page
router.get('/checkslot', (req, res) => {
    res.render('checkslot');
});

router.post(
    '/checkslot',
    otpLimiter,
    [
        body('date').isISO8601().withMessage('Invalid date format'),
        body('slot').notEmpty().withMessage('Slot is required'),
        body('phone').isMobilePhone('any').withMessage('Invalid phone number')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { date, slot, phone, city } = req.body;

        try {
            const [results] = await db.query(
                'SELECT * FROM slots WHERE date = ? AND slot = ?',
                [date, slot]
            );

            if (results.length !== 0) {
                return res.status(400).json({ error: 'Slot not available' });
            }

            await client.verify.v2
                .services(process.env.TWILIO_SERVICE_SID)
                .verifications.create({
                    to: phone,
                    channel: 'sms'
                });

            req.session.date = date;
            req.session.slot = slot;
            req.session.phone = phone;
            req.session.city = city;
            req.session.otp_requested = true;

            return res.json({ redirect: '/verify-otp' });

        } catch (err) {
            console.error('❌ Error in /checkslot:', err.message);
            return res.status(500).json({ error: 'Failed to process request' });
        }
    }
);

// OTP Verification
router.get('/verify-otp', (req, res) => {
    if (!req.session.otp_requested) return res.redirect('/');
    res.render('verify-otp');
});

router.post('/verify-otp',
    [
        body('otp').trim().isLength({ min: 4, max: 10 }).withMessage('Invalid OTP format')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { otp } = req.body;
        const { phone } = req.session;

        if (!req.session.otp_requested) {
            return res.status(400).json({ error: 'OTP not requested' });
        }

        try {
            const verification_check = await client.verify.v2.services(process.env.TWILIO_SERVICE_SID)
                .verificationChecks
                .create({ to: phone, code: otp });

            if (verification_check.status === 'approved') {
                req.session.otp_verified = true;
                res.json({ redirect: '/add-appointment' });
            } else {
                res.status(400).json({ error: 'Invalid OTP' });
            }
        } catch (error) {
            console.error('Failed to verify OTP:', error);
            res.status(500).json({ error: 'Failed to verify OTP' });
        }
    });

router.post('/save-chat-query',
    [
        body('name').trim().notEmpty().withMessage('Name is required').escape(),
        body('email').trim().isEmail().withMessage('Invalid email address').normalizeEmail(),
        body('phone').trim().isMobilePhone('any').withMessage('Invalid phone number'),
        body('question').trim().notEmpty().withMessage('Question/Message is required').escape()
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { name, email, phone, question } = req.body;

        try {
            await db.query(
                'INSERT INTO call_requests (name, email, phone, message) VALUES (?, ?, ?, ?)',
                [name, email, phone, question]
            );

            // Optional: Notify Admin via WebSocket
            if (req.app.locals.notifyClients) {
                req.app.locals.notifyClients({
                    type: 'new_call_request',
                    message: `New call request from ${name}`
                });
            }

            res.json({ success: true, message: 'We will get to you soon' });
        } catch (err) {
            console.error('Error saving chat query:', err);
            res.status(500).json({ error: 'Failed to save request' });
        }
    }
);

// Other Public Routes
router.get('/services', (req, res) => {
    res.render('services/index3');
});

router.get('/services/:slug', (req, res) => {
    const data = getServicesData();
    const page = data.find(p => p.slug === req.params.slug);

    if (!page) {
        return res.status(404).render('error', { message: 'Service not found' });
    }

    res.render('services/template', {
        page,
        allPages: data
    });
});

router.get('/about', (req, res) => res.render('about'));
router.get('/faq', (req, res) => res.render('faq'));
router.get('/conditions', (req, res) => res.render('conditions'));
router.get('/error', (req, res) => res.render('error'));

module.exports = router;
