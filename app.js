const express = require('express');
const bodyParser = require('body-parser');
const { body, validationResult } = require('express-validator');
const session = require('express-session');
const mysql = require('mysql');
const path = require('path');
const twilio = require('twilio');
const dotenv = require('dotenv');
const fs = require('fs');
const app = express();
// const phpServer = require('node-php-server');
app.set('views', '/var/task/views');
dotenv.config(); // Load environment variable
const port = 3000;

app.set('view engine', 'ejs');
app.use(bodyParser.json());
// app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({ secret: 'secret', resave: false, saveUninitialized: true }));

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

// php stuffs

// phpServer.createServer({
//     port: 8000,
//     hostname: '127.0.0.1',
//     base: path.join(__dirname, 'php'), // Directory where PHP files are located
//     keepalive: false,
//     open: false,
//   });

//   app.use('/php', (req, res) => {
//     const phpUrl = `http://127.0.0.1:8000${req.originalUrl.replace('/php', '')}`;
//     res.redirect(phpUrl);
//   });
  


db.connect(err => {
    if (err) throw err;
    console.log('Connected to database.');
});

app.get('/', (req, res) => {
    res.render(path.join(__dirname, 'views/index'));
});


// Serve the check-slot.html page
app.get('/checkslot', (req, res) => {
    res.render(path.join(__dirname, 'views/checkslot'));
});

// Serve the OTP verify page
app.get('/verify-otp', (req, res) => {
    // if (!req.session.otp_requested) {
    //     return res.redirect('/');
    // }
    res.render(path.join(__dirname, 'views/verify-otp'));
});

// Serve the add appointment page
app.get('/add-appointment', (req, res) => {
    // if (!req.session.otp_verified) {
    //     return res.redirect('/');
    // }
    res.render(path.join(__dirname,  'views/appointment'));
});

app.get('/added', (req, res) => {
    // if (!req.session.otp_verified) {
    //     return res.redirect('/');
    // }
    res.render(path.join(__dirname,  'views/add'));
});


app.post('/checkslot', [
    body('date').isISO8601().withMessage('Invalid date format').custom((value) => {
        const inputDate = new Date(value);
        const currentDate = new Date();
        if (inputDate < currentDate.setHours(0, 0, 0, 0)) {
            throw new Error('Date cannot be in the past');
        }
        return true;
    }),
    body('slot').notEmpty().withMessage('Slot is required'),
    body('phone').isMobilePhone('any').withMessage('Invalid phone number')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { date, slot, phone } = req.body;

    db.query('SELECT * FROM slots WHERE date = ? AND slot = ?', [date, slot], (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Database query error' });
        }

        if (results.length === 0) {
            // Slot is available, send OTP
            client.verify.v2.services('VA748199d35535a2bd83e8c1ef972ca77d')
                .verifications
                .create({ to: phone, channel: 'sms' })
                .then(verification => {
                    req.session.date = date;
                    req.session.slot = slot;
                    req.session.phone = phone;
                    req.session.otp_requested = true;
                    res.json({ redirect: '/otp-verify' });
                })
                .catch(error => {
                    console.error('Failed to send OTP:', error);
                    res.status(500).json({ error: 'Failed to send OTP' });
                });
        } else {
            res.status(400).json({ error: 'Slot not available' });
        }
    });
});

app.post('/verify-otp', [
    body('otp').isLength({ min: 4, max: 6 }).withMessage('Invalid OTP')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { otp } = req.body;
    const { phone } = req.session;

    if (!req.session.otp_requested) {
        return res.status(400).json({ error: 'OTP not requested' });
    }

    client.verify.v2.services('VA748199d35535a2bd83e8c1ef972ca77d')
        .verificationChecks
        .create({ to: phone, code: otp })
        .then(verification_check => {
            if (verification_check.status === 'approved') { 
                req.session.otp_verified = true;
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

app.post('/add-appointment', [
    body('name').trim().escape().notEmpty().withMessage('Name is required'),
    body('address').trim().escape().notEmpty().withMessage('Address is required')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { name, address } = req.body;
  //  const { date, slot, phone } = req.session;
    const date=7;
    const slot= 2;
    const phone= 0;
   //remove comments here // if (!req.session.otp_verified) {
    //     return res.status(400).json({ error: 'OTP not verified' });
    // }

    db.query('INSERT INTO appointments (name, address, date, slot, phone) VALUES (?, ?, ?, ?, ?)',
        [name, address, date, slot, phone], (err, results) => {
            if (err) {
                console.log(err);
                return res.status(500).json({ error: 'Database insert error' });
            }
// insert into slot also 

            if (results && results.affectedRows > 0) {
                // Redirect to /added if the query was successful
                return res.json({ redirect: '/added' });
            } else {
            
                return res.status(500).json({ error: 'Database insert error' });
            }

            req.session.destroy();
            
        });
       
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
