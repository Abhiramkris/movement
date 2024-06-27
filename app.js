const express = require('express');
const bodyParser = require('body-parser');
const { body, validationResult } = require('express-validator');
const session = require('express-session');
const mysql = require('mysql');
const path = require('path');
const twilio = require('twilio');
const dotenv = require('dotenv');
const fs = require('fs');
// const phpServer = require('node-php-server');
dotenv.config(); // Load environment variables
const app = express();
const port = 3000;

app.set('view engine', 'ejs');
app.use(bodyParser.json());
app.set('views', path.join(__dirname, 'views'));
app.set('public', path.join(__dirname, 'public'));
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

app.get('/howhelp/index', (req, res) => {
    res.render(path.join(__dirname, 'views/howhelp/index1'));
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
    res.render(path.join(__dirname, 'views/appointment'));
});

app.get('/added', (req, res) => {
    // if (!req.session.otp_verified) {
    //     return res.redirect('/');
    // }
    res.render(path.join(__dirname, 'views/add'));
});

app.post('/send-notification', (req, res) => {
    

    const { message } = req.body;

    // Broadcast the message to all connected clients
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });

    res.json({ message: 'Notification sent successfully' });
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

    const { date, slot, phone, city } = req.body;

    db.query('SELECT * FROM slots WHERE date = ? AND slot = ?', [date, slot], (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Database query error' });
        }
        if (results.length === 0) {
            console.log('yeah');
            req.session.date = date;
            req.session.slot = slot;
            req.session.phone = phone;
            req.session.city=city;
            req.session.otp_requested = true;
            res.json({ redirect: '/add-appointment' }); //remove later
        }
        else{
            return res.status(400).json({ error: 'Slot already occupied' });
        }

        // if (results.length === 0) {
        //     // Slot is available, send OTP
        //     client.verify.v2.services('VA748199d35535a2bd83e8c1ef972ca77d')
        //         .verifications
        //         .create({ to: phone, channel: 'sms' })
        //         .then(verification => {
        //             req.session.date = date;
        //             req.session.slot = slot;
        //             req.session.phone = phone;
        //             req.session.otp_requested = true;
        //             res.json({ redirect: '/otp-verify' });
        //         })
        //         .catch(error => {
        //             console.error('Failed to send OTP:', error);
        //             res.status(500).json({ error: 'Failed to send OTP' });
        //         });
        // } else {
        //     res.status(400).json({ error: 'Slot not available' });
        // }
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
    body('address').trim().escape().notEmpty().withMessage('Address is required'),
    body('email').trim().escape().notEmpty().withMessage('email is required')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { name, address, email} = req.body;
    const date = req.session.date;
    const slot = req.session.slot;
    const phone = req.session.phone;
    const city= req.session.city;

    // Assuming OTP verification is not currently part of the logic
    // if (!req.session.otp_verified) {
    //  const is_verified = 0;
    //     return res.status(400).json({ error: 'OTP not verified' });
    // }
    // else{
//      const_verfied =1;
    // }

    // add verfied here
    if (!date || !slot || !phone||!email||!city) {
        console.log('Session data is missing:', { date, slot, phone });
        return res.status(400).json({ error: 'data is missing pls try again' });
    }


    // Insert into appointments table
    db.query('INSERT INTO appointments (name, address, date, slot, phone, email, city) VALUES (?, ?, ?, ?, ?,?,?)',
        [name, address, date, slot, phone,email,city], (err, results) => {
            if (err) {
                console.log('Database insert error:', err);
                return res.status(500).json({ error: 'Database insert error' });
            }

            if (results.affectedRows === 1) {
                console.log('Number of affected rows:', results.affectedRows);
                console.log('Successfully inserted the appointment.');

                // Insert into slots table
                db.query('INSERT INTO slots (slot, date) VALUES (?, ?)', [slot, date], (err, result) => {
                    if (err) {
                        console.log('Error inserting into slots table:', err);
                        return res.status(500).json({ error: 'Error inserting into slots table' });
                    } else {
                        console.log('Inserted into slots:', result);

                        // Destroy the session after successful inserts
                        req.session.destroy((err) => {
                            if (err) {
                                console.log('Session destruction error:', err);
                                return res.status(500).json({ error: 'Session destruction error' });
                            }
                            console.log('Redirecting to /added');
                            return res.json({ redirect: '/added' }); //make it bloclk url
                        });
                    }
                });
            } else {
                console.log('Unexpected number of affected rows:', results.affectedRows);
                return res.status(500).json({ error: 'Unexpected number of affected rows' });
            }
        });
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
