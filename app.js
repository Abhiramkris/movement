const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const { body, validationResult } = require('express-validator');
const mysql = require('mysql');
const twilio = require('twilio');
const dotenv = require('dotenv');

dotenv.config(); // Load environment variables

const app = express();
const port = 3000;

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

const serviceSid = process.env.TWILIO_SERVICE_SID;

// MySQL connection setup
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

db.connect((err) => {
    if (err) {
        console.error('Error connecting to database:', err);
    } else {
        console.log('Connected to database.');
    }
});

// Middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(session({
    secret: 'hellosos12',
    resave: true,
    saveUninitialized: true
}));

// Routes
app.post('/checkslot', [
    body('date').isISO8601().withMessage('Date must be a valid date')
        .custom((value, { req }) => {
            const inputDate = new Date(value);
            const currentDate = new Date();
            if (inputDate < currentDate.setHours(0, 0, 0, 0)) {
                throw new Error('Date cannot be in the past');
            }
            req.dayy = value;
            return true;
        }),
    body('slot').notEmpty().withMessage('Slot is required'),
    body('phone').notEmpty().withMessage('Phone number is required')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { date, slot, phone } = req.body;
    const query = 'SELECT * FROM slots WHERE date = ? AND slot = ?';
    db.query(query, [date, slot], (error, results) => {
        if (error) {
            return res.status(500).json({ error: 'Database query error' });
        }

        if (results.length === 0) {
            // Slot is available
            const sql = 'INSERT INTO slots (date, slot) VALUES (?, ?)';
            db.query(sql, [date, slot], (err, result) => {
                if (err) {
                    return res.status(500).send('Error adding appointment');
                }
                req.session.otpRequested = true;
                req.session.slotInfo = { date, slot };
                client.verify.v2.services(serviceSid)
                    .verifications
                    .create({ to: phone, channel: 'sms' })
                    .then(verification => {
                        res.json({ redirect: '/verify-otp', date, slot });
                    })
                    .catch(error => {
                        console.error('Failed to send OTP:', error);
                        res.status(500).json({ error: 'Failed to send OTP' });
                    });
            });
        } else {
            res.status(400).json({ error: 'Slot not available for the selected date' });
        }
    });
});

app.get('/verify-otp', (req, res) => {
    res.sendFile(__dirname + '/ok.html');
});

app.get('/verify-otp', (req, res) => {
    if (!req.session.otpRequested) {
        return res.status(403).send('Forbidden');
    }
    res.sendFile(__dirname + '/verify-otp.html');
});

app.post('/verify-otp', (req, res) => {
    const { otp, phone } = req.body;
    client.verify.v2.services(serviceSid)
        .verificationChecks
        .create({ to: phone, code: otp })
        .then(verification_check => {
            if (verification_check.status === 'approved') {
                req.session.otpVerified = true;
                res.json({ redirect: '/add-appointment' });
            } else {
                res.status(400).json({ error: 'Invalid OTP' });
            }
        })
        .catch(error => {
            console.error('Failed to verify OTP:', error);
            res.status(500).json({ error: 'Failed to verify OTP' });
        });
});

app.get('/add-appointment', (req, res) => {
    if (!req.session.otpVerified) {
        return res.status(403).send('Forbidden');
    }
    res.sendFile(__dirname + '/add.html');
});

app.post('/add-appointment', (req, res) => {
    const { name, address } = req.body;
    const sanitizedAddress = address.replace(/[^a-zA-Z0-9\s]/g, '');
    const query = 'INSERT INTO appointments (name, address) VALUES (?, ?)';
    db.query(query, [name, sanitizedAddress], (error, results) => {
        if (error) {
            return res.status(500).json({ error: 'Database query error' });
        }
        res.send('Appointment added successfully!');
    });
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
