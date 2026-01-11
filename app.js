/******************************************************************
 * CORE SETUP
 ******************************************************************/
const express = require('express');
const bodyParser = require('body-parser');
const { body, validationResult } = require('express-validator');
const session = require('express-session');
const mysql = require('mysql2/promise');
const path = require('path');
const twilio = require('twilio');
const dotenv = require('dotenv');
const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const ejs = require('ejs');
dotenv.config();

const app = express();
const port = process.env.PORT || 3200;
const server = http.createServer(app);

/******************************************************************
 * WEBSOCKET (UNCHANGED)
 ******************************************************************/
const wss = new WebSocket.Server({ port: 8000 });
let clients = [];

wss.on('connection', ws => {
    clients.push(ws);
    ws.on('close', () => {
        clients = clients.filter(c => c !== ws);
    });
    ws.on('message', message => {
        console.log('Received:', message);
    });
});


/******************************************************************
 * MIDDLEWARE
 ******************************************************************/
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
    secret: 'secret',
    resave: true,
    saveUninitialized: true
}));

/******************************************************************
 * DATABASE
 ******************************************************************/
// const db = mysql.createConnection({
//     host: process.env.DB_HOST,
//     port: process.env.DB_PORT,
//     user: process.env.DB_USER,
//     password: process.env.DB_PASSWORD,
//     database: process.env.DB_NAME
// });

const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

(async () => {
    try {
        const connection = await db.getConnection();
        console.log('✅ MySQL pool connected');
        connection.release();
    } catch (err) {
        console.error('❌ MySQL connection error:', {
            code: err.code,
            errno: err.errno,
            message: err.message
        });
    }
})();

// const promiseDb = db.promise();


/******************************************************************
 * HELPERS
 ******************************************************************/
function normalizePhone(phone) {
    if (!phone) return null;
    phone = phone.toString().replace(/[^\d+]/g, '');
    if (phone.startsWith('+91')) return phone;
    if (phone.length === 10) return '+91' + phone;
    return phone;
}

function requireAdmin(req, res, next) {
    if (req.session?.isAdmin) return next();

    const token =
        req.cookies.admin_jwt ||
        req.headers.authorization?.replace('Bearer ', '');

    if (!token) return res.status(401).json({ message: 'Unauthorized' });

    try {
        jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ message: 'Unauthorized' });
    }
}

/******************************************************************
 * TWILIO
 ******************************************************************/
const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

/******************************************************************
 * ROUTER
 ******************************************************************/
const router = express.Router();


function notifyClients(message) {
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}


app.set('view engine', 'ejs');
app.use(bodyParser.json());
app.set('views', path.join(__dirname, 'views'));
app.set('public', path.join(__dirname, 'public'));

app.use(express.static(path.join(__dirname, 'public')));

app.use(session({ secret: 'secret', resave: true, saveUninitialized: true }));


// db.getConnection((err, connection) => {
//     if (err) {
//         console.error("Database connection failed: " + err.message);
//     } else {
//         console.log("Connected to database");
//         connection.release();
//     }
// });

// Middleware function to require admin authentication

// function requireAdmin(req, res, next) {
//     if (req.session && req.session.isAdmin) {
//         next();
//     } else {
//         res.status(401).json({ message: 'Unauthorized' });
//     }
// }



/**************** ADMIN AUTH ****************/
router.get('/login', (req, res) => {
    res.render('admin/login');
});

router.post('/login', (req, res) => {
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
            sameSite: 'strict'
        });

        return res.json({ redirect: '/admin/dashboard' });
    }

    res.status(401).json({ error: 'Invalid credentials' });
});

router.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('admin_jwt');
        res.render('admin/login');
    });
});

app.post('/save-chat-query', async (req, res) => {
    const { name, email, phone, question } = req.body;
    console.log(req.body);

    // Validate incoming data
    if (!name || !email || !phone || !question) {
        return res.status(400).json({ message: 'Missing required fields' });
    }

    try {
        await db.query(
            'INSERT INTO chat_queries (name, email, phone, question) VALUES (?, ?, ?, ?)',
            [name, email, phone, question]
        );

        res.json({ message: 'Query saved successfully' });
    } catch (err) {
        console.error('❌ Error inserting chat query:', {
            code: err.code,
            message: err.message
        });

        res.status(500).json({
            message: 'Failed to save query',
            error: err.message
        });
    }
});


app.get('/admin/live-chat-queries', requireAdmin, async (req, res) => {
    try {
        const [results] = await db.query(
            'SELECT * FROM chat_queries ORDER BY id DESC'
        );

        res.json(results);
    } catch (err) {
        console.error('❌ Error fetching live chat queries:', {
            code: err.code,
            message: err.message
        });

        res.status(500).json({ error: 'Internal Server Error' });
    }
});


// Admin dashboard route filter here
app.get('/admin/dashboard', requireAdmin, async (req, res) => {
    const filterDate = req.query.date || '';

    let query = 'SELECT * FROM appointments';
    const queryParams = [];

    if (filterDate) {
        query += ' WHERE date = ?';
        queryParams.push(filterDate);
    }

    try {
        const [results] = await db.query(query, queryParams);

        res.render('admin/dashboard', {
            appointments: results,
            filterDate
        });
    } catch (err) {
        console.error('❌ Database error (fetch appointments):', {
            code: err.code,
            message: err.message
        });

        res.status(500).json({
            message: 'Failed to fetch appointments',
            error: err.message
        });
    }
});

// POST request to approve an appointment
router.post('/approve-appointment/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { remarks } = req.body;

    try {
        // 1️⃣ Fetch appointment
        const [results] = await db.query(
            'SELECT * FROM appointments WHERE id = ?',
            [id]
        );

        if (!results || results.length === 0) {
            return res.status(404).json({ message: 'Appointment not found' });
        }

        const appointment = results[0];

        // 2️⃣ Insert into approved_appointments
        await db.query(
            `INSERT INTO approved_appointments 
            (name, address, date, slot, phone, email, city, remarks) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                appointment.name,
                appointment.address,
                appointment.date,
                appointment.slot,
                appointment.phone,
                appointment.email,
                appointment.city,
                remarks
            ]
        );

        // 3️⃣ Delete from appointments
        await db.query(
            'DELETE FROM appointments WHERE id = ?',
            [id]
        );

        return res.status(200).json({
            message: 'Appointment approved successfully'
        });

    } catch (err) {
        console.error('❌ Error approving appointment:', {
            code: err.code,
            message: err.message
        });

        return res.status(500).json({
            message: 'Failed to approve appointment',
            error: err.message
        });
    }
});


router.delete('/delete-appointment/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        // 1️⃣ Fetch slot details before deletion
        const [selectResults] = await db.query(
            'SELECT date, slot FROM appointments WHERE id = ?',
            [id]
        );

        if (!selectResults || selectResults.length === 0) {
            return res.status(404).json({ message: 'Appointment not found' });
        }

        const { date, slot } = selectResults[0];

        // 2️⃣ Delete appointment
        await db.query(
            'DELETE FROM appointments WHERE id = ?',
            [id]
        );

        // 3️⃣ Delete corresponding slot
        await db.query(
            'DELETE FROM slots WHERE date = ? AND slot = ?',
            [date, slot]
        );

        return res.status(200).json({
            message: 'Appointment and corresponding slot deleted successfully'
        });

    } catch (err) {
        console.error('❌ Error deleting appointment:', {
            code: err.code,
            message: err.message
        });

        return res.status(500).json({
            message: 'Failed to delete appointment',
            error: err.message
        });
    }
});

function normalizePhone(phone) {
    if (!phone) return null;
    phone = phone.toString().replace(/[^\d+]/g, '');

    if (phone.startsWith('+91')) return phone;
    if (phone.startsWith('91') && phone.length === 12) return '+' + phone;
    if (phone.length === 10) return '+91' + phone;

    return phone;
}

router.post('/patient-history', requireAdmin, async (req, res) => {
    const { name } = req.body;

    if (!name || name.trim().length < 2) {
        return res.status(400).send('Invalid patient name');
    }

    try {
        // 1️⃣ Fetch ALL visits by name
        const [visits] = await db.query(
            `
            SELECT date, slot, remarks, phone
            FROM approved_appointments
            WHERE LOWER(name) = LOWER(?)
            ORDER BY date DESC
            `,
            [name.trim()]
        );

        if (!visits || visits.length === 0) {
            return res.render('patient-history', {
                name,
                visits: [],
                customer: {},
                csrfToken: req.session.csrfToken
            });
        }

        // 2️⃣ Normalize phone from first visit
        const phone = normalizePhone(visits[0].phone);

        if (!phone) {
            return res.render('patient-history', {
                name,
                visits,
                customer: {},
                csrfToken: req.session.csrfToken
            });
        }

        // 3️⃣ Fetch customer profile (notes + photo)
        const [customers] = await db.query(
            'SELECT * FROM customers WHERE phone = ? LIMIT 1',
            [phone]
        );

        const customer = customers?.[0] || {};

        return res.render('patient-history', {
            name: customer.name || name,
            visits,
            customer,
            csrfToken: req.session.csrfToken
        });

    } catch (err) {
        console.error('❌ Error fetching patient history:', {
            code: err.code,
            message: err.message
        });

        return res.render('patient-history', {
            name,
            visits: [],
            customer: {},
            csrfToken: req.session.csrfToken
        });
    }
});




router.post('/update-photo', requireAdmin, (req, res) => {
    db.query(
        'UPDATE customers SET photo_url=? WHERE phone=?',
        [req.body.photo, req.body.phone],
        () => res.json({ ok: true })
    );
});

router.post('/updatenotes', async (req, res) => {
    const { name, notes } = req.body;

    if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'Invalid name' });
    }

    try {
        const [result] = await db.query(
            'UPDATE customers SET admin_notes = ? WHERE LOWER(name) = LOWER(?)',
            [notes ?? null, name.trim()]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Customer not found' });
        }

        return res.status(200).json({ ok: true });

    } catch (err) {
        console.error('❌ Update notes error:', {
            code: err.code,
            message: err.message
        });

        return res.status(500).json({ error: 'Database error' });
    }
});


router.get('/patient-search', requireAdmin, async (req, res) => {
    const q = `%${req.query.q}%`;

    try {
        const [rows] = await db.query(
            `
            SELECT DISTINCT name, phone
            FROM approved_appointments
            WHERE name LIKE ? OR phone LIKE ?
            LIMIT 10
            `,
            [q, q]
        );

        res.json(rows);
    } catch (err) {
        console.error('❌ Database error (patient search):', {
            code: err.code,
            message: err.message
        });

        res.status(500).json([]);
    }
});





// Mount the admin routes under /admin
app.use('/admin', router);


// Create a Nodemailer transporter
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Schedule the cron job (runs once at 8:00 AM)
cron.schedule('0 8 * * *', async () => {
    console.log('Running the daily appointment email task');
    await sendAppointmentEmails();
}, {
    scheduled: true,
    timezone: "America/New_York"
});


console.log('Appointment email scheduler started.');

async function sendAppointmentEmails() {
    try {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);

        const dateString = tomorrow.toISOString().split('T')[0];

        console.log(`Fetching appointments for date: ${dateString}`);

        const [results] = await db.query(
            'SELECT * FROM appointments WHERE date = ? AND reminder_sent = 0',
            [dateString]
        );

        if (results.length === 0) {
            console.log('No appointments for tomorrow.');
            return;
        }

        console.log(`Found ${results.length} appointments for tomorrow.`);

        // Send emails sequentially (safe for SMTP + DB)
        for (const appointment of results) {
            await sendEmail(appointment);
        }

    } catch (err) {
        console.error('❌ Error in sendAppointmentEmails:', {
            code: err.code,
            message: err.message
        });
    }
}


// Function to send email
async function sendEmail(appointment) {
    try {
        // 1️⃣ Generate email HTML
        const emailHtml = await generateEmailHtml(appointment);

        // 2️⃣ Send email
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: appointment.email,
            subject: 'Your Appointment Reminder',
            html: emailHtml
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`Email sent to ${appointment.email}: ${info.response}`);

        // 3️⃣ Mark reminder as sent
        await db.query(
            'UPDATE appointments SET reminder_sent = 1 WHERE id = ?',
            [appointment.id]
        );

        console.log(
            `Marked appointment ID ${appointment.id} as reminder sent.`
        );

    } catch (err) {
        console.error('❌ Error sending reminder email:', {
            appointmentId: appointment?.id,
            code: err.code,
            message: err.message
        });
    }
}

// Function to generate email HTML
async function generateEmailHtml(appointment) {
    const emailTemplate = path.join(__dirname, 'emailTemplate.ejs');
    const appointmentDate = new Date(appointment.date);
    const formattedDate = appointmentDate.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'long',
        year: 'numeric'
    });
    return ejs.renderFile(emailTemplate, {
        name: appointment.name,
        date: formattedDate,
        slot: appointment.slot
    });
}

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
    if (!req.session.otp_requested) {
        return res.redirect('/');
    }
    res.render(path.join(__dirname, 'views/verify-otp'));
});

// Serve the add appointment page
app.get('/add-appointment', (req, res) => {
    if (!req.session.otp_verified) {
        return res.redirect('/');
    }
    res.render(path.join(__dirname, 'views/appointment'));
});

app.get('/added', (req, res) => {
    res.render(path.join(__dirname, 'views/add'));
});

app.post(
    '/checkslot',
    [
        body('date')
            .isISO8601()
            .withMessage('Invalid date format')
            .custom(value => {
                const inputDate = new Date(value);
                const currentDate = new Date();

                currentDate.setHours(3, 0, 0, 0);

                if (inputDate < new Date().setHours(0, 0, 0, 0)) {
                    throw new Error('Date cannot be in the past');
                }

                if (
                    inputDate.toDateString() === currentDate.toDateString() &&
                    new Date() >= currentDate
                ) {
                    throw new Error('Cannot register for today after 11 AM');
                }
                return true;
            }),
        body('slot').notEmpty().withMessage('Slot is required'),
        body('phone').isMobilePhone('any').withMessage('Invalid phone number')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { date, slot, phone, city } = req.body;

        if (!date || isNaN(Date.parse(date)))
            return res.status(400).json({ message: 'Invalid date' });

        if (!/^slot\d+$/.test(slot))
            return res.status(400).json({ message: 'Invalid slot' });

        if (/[^\d+\-\s]/.test(phone))
            return res.status(400).json({ message: 'Not allowed' });

        if (!/^[a-zA-Z\s]{2,40}$/.test(city))
            return res.status(400).json({ message: 'Invalid city' });

        try {
            // 1️⃣ Check slot availability
            const [results] = await db.query(
                'SELECT * FROM slots WHERE date = ? AND slot = ?',
                [date, slot]
            );

            if (results.length !== 0) {
                return res.status(400).json({ error: 'Slot not available' });
            }

            // 2️⃣ Send OTP
            await client.verify.v2
                .services(process.env.TWILIO_SERVICE_SID)
                .verifications.create({
                    to: phone,
                    channel: 'sms'
                });

            // 3️⃣ Store session data
            req.session.date = date;
            req.session.slot = slot;
            req.session.phone = phone;
            req.session.city = city;
            req.session.otp_requested = true;

            return res.json({ redirect: '/verify-otp' });

        } catch (err) {
            console.error('❌ Error in /checkslot:', {
                code: err.code,
                message: err.message
            });

            return res.status(500).json({
                error: 'Failed to process request'
            });
        }
    }
);

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

    client.verify.v2.services(process.env.TWILIO_SERVICE_SID)
        .verificationChecks
        .create({ to: phone, code: otp })
        .then(verification_check => {
            if (verification_check.status === 'approved') {
                req.session.otp_verified = true;
                res.json({ redirect: '/add-appointment' });
                // see if the phone number laredy exist if it exists take the user id also add to trusted device 
            } else {
                res.status(400).json({ error: 'Invalid OTP' });

            }
        })
        .catch(error => {
            console.error('Failed to verify OTP:', error);
            res.status(500).json({ error: 'Failed to verify OTP' });
        });
});

app.get('/appointmentsall', requireAdmin, async (req, res) => {
    try {
        const [results] = await db.query(
            'SELECT * FROM approved_appointments'
        );

        res.render('allAppo', { appointments: results });
    } catch (err) {
        console.error('❌ Error fetching appointments:', {
            code: err.code,
            message: err.message
        });

        res.status(500).json({
            message: 'Failed to fetch appointments',
            error: err.message
        });
    }
});


app.post(
    '/add-appointment',
    [
        body('name').trim().escape().notEmpty().withMessage('Name is required'),
        body('address').trim().escape().notEmpty().withMessage('Address is required'),
        body('email').trim().escape().notEmpty().withMessage('Email is required')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { name, address, email } = req.body;

        const date = req.session.date;
        const slot = req.session.slot;
        const phone = req.session.phone;
        const city = req.session.city;

        if (!date || !slot || !phone || !email || !city) {
            console.log('Session data is missing:', { date, slot, phone });
            return res.status(400).json({
                error: 'Session data is missing, please try again'
            });
        }

        try {
            // 1️⃣ Insert appointment
            const [appointmentResult] = await db.query(
                'INSERT INTO appointments (name, address, email, phone, city, date, slot) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [name, address, email, phone, city, date, slot]
            );

            if (appointmentResult.affectedRows !== 1) {
                console.log('Unexpected number of affected rows:', appointmentResult.affectedRows);
                return res.status(500).json({
                    error: 'Unexpected number of affected rows'
                });
            }

            console.log('Successfully inserted the appointment.');

            // 2️⃣ Insert / update customer
            const customerSql = `
        INSERT INTO customers (name, address, email, phone, city)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          address = VALUES(address),
          email = VALUES(email),
          phone = VALUES(phone),
          city = VALUES(city)
      `;

            await db.query(customerSql, [name, address, email, phone, city]);

            // 3️⃣ Insert slot
            await db.query(
                'INSERT INTO slots (date, slot) VALUES (?, ?)',
                [date, slot]
            );

            // 4️⃣ Notify WebSocket clients
            const notification = JSON.stringify({
                title: 'New Appointment Added',
                body: `New appointment with ${name} on ${date} during ${slot}.`
            });

            clients.forEach(client => client.send(notification));

            // 5️⃣ Destroy session
            req.session.destroy(sessionErr => {
                if (sessionErr) {
                    console.error('Session destruction error:', sessionErr);
                    return res.status(500).json({ error: 'Cleanup error' });
                }

                return res.json({ redirect: '/added' });
            });

        } catch (err) {
            console.error('❌ Database error (add appointment):', {
                code: err.code,
                message: err.message
            });

            return res.status(500).json({
                error: 'Database insert error'
            });
        }
    }
);


app.get('/howhelp/recovery', (req, res) => {
    res.render(path.join(__dirname, 'views/howhelp/recovery'));
});

app.get('/howhelp/balance', (req, res) => {
    res.render(path.join(__dirname, 'views/howhelp/balance'));
});

app.get('/howhelp/jointpain', (req, res) => {
    res.render(path.join(__dirname, 'views/howhelp/jointpain'));
});

app.get('/howhelp/sports', (req, res) => {
    res.render(path.join(__dirname, 'views/howhelp/sports'));
});

app.get('/howhelp/muscularweak', (req, res) => {
    res.render(path.join(__dirname, 'views/howhelp/muscularweak'));
});

app.get('/howhelp/conf', (req, res) => {
    res.render(path.join(__dirname, 'views/howhelp/confidence'));
});

app.get('/howhelp/swelljoints', (req, res) => {
    res.render(path.join(__dirname, 'views/howhelp/swelljoints'));
});

app.get('/howhelp/backtowork', (req, res) => {
    res.render(path.join(__dirname, 'views/howhelp/backtowork'));
});

app.get('/howhelp/mobilediff', (req, res) => {
    res.render(path.join(__dirname, 'views/howhelp/mobilediff'));
});


app.get('/howhelp/falls', (req, res) => {
    res.render(path.join(__dirname, 'views/howhelp/falls'));
});

app.get('/howhelp/balance', (req, res) => {
    res.render(path.join(__dirname, 'views/howhelp/mobilediff'));
});

app.get('/howhelp/confidence', (req, res) => {
    res.render(path.join(__dirname, 'views/howhelp/confidence'));
});

app.get('/services', (req, res) => {
    res.render(path.join(__dirname, 'views/services/index3.ejs'));
});
app.get('/services/ser1', (req, res) => {
    res.render(path.join(__dirname, 'views/services/ser1.ejs'));
});
app.get('/services/ser2', (req, res) => {
    res.render(path.join(__dirname, 'views/services/ser2.ejs'));
});
app.get('/services/ser3', (req, res) => {
    res.render(path.join(__dirname, 'views/services/ser3.ejs'));
});
app.get('/services/ser4', (req, res) => {
    res.render(path.join(__dirname, 'views/services/ser4.ejs'));
});
app.get('/services/ser5', (req, res) => {
    res.render(path.join(__dirname, 'views/services/ser5.ejs'));
});
app.get('/services/ser6', (req, res) => {
    res.render(path.join(__dirname, 'views/services/ser6.ejs'));
});
app.get('/conditions', (req, res) => {
    res.render(path.join(__dirname, 'views/conditions'));
});
app.get('/faq', (req, res) => {
    res.render(path.join(__dirname, 'views/faq'));
});
app.get('/error', (req, res) => {
    res.render(path.join(__dirname, 'views/error'));
});

app.get('/freecall', (req, res) => {
    res.render('freecall');
});

app.get('/callus', (req, res) => {
    res.render('freecall');
});

app.get('/contactedsoon', (req, res) => {
    res.render('soon');
});

app.get('/about', (req, res) => {
    res.render('about');
});

app.post('/freecall', async (req, res) => {
    const { name, phone } = req.body;

    if (!name || !phone) {
        // Check if required fields are missing
        return res.status(400).json({ error: 'Name and phone number are required' });
    }

    // Insert new customer

    const addCallRequestQuery =
        'INSERT INTO call_requests (phone, name) VALUES (?, ?)';

    try {
        await db.query(addCallRequestQuery, [phone, name]);
        res.json({ redirect: '/contactedsoon' });
    } catch (err) {
        console.error('❌ Database error (add call request):', {
            code: err.code,
            message: err.message
        });

        res.status(500).json({ error: 'Database error' });
    }

});



app.get('/admin/call', requireAdmin, async (req, res) => {
    const getCallRequestsQuery = `
        SELECT id, name, phone
        FROM call_requests
        ORDER BY id DESC
    `;

    try {
        const [results] = await db.query(getCallRequestsQuery);

        res.render('admin/caller', { callRequests: results });
    } catch (err) {
        console.error('❌ Database error (fetch call requests):', {
            code: err.code,
            message: err.message
        });

        res.status(500).json({ error: 'Database error' });
    }
});




// Route to delete a call request
app.post('/admin/delete/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;

    console.log('Deleting call request with ID:', id);

    const deleteCallRequestQuery =
        'DELETE FROM call_requests WHERE id = ?';

    try {
        await db.query(deleteCallRequestQuery, [id]);
        res.redirect('/admin/call');
    } catch (err) {
        console.error('❌ Database error (delete call request):', {
            code: err.code,
            message: err.message
        });

        res.status(500).send('Internal Server Error');
    }
});

app.post('/admin/call/delete/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        await db.query(
            'DELETE FROM call_requests WHERE id = ?',
            [id]
        );

        res.redirect('/admin/call');
    } catch (err) {
        console.error('❌ Database error (delete call request):', {
            code: err.code,
            message: err.message
        });

        res.status(500).send('Server Error');
    }
});

module.exports = router;

app.use((req, res) => {
    if (
        req.headers.accept?.includes('application/json') ||
        req.headers['content-type']?.includes('application/json') ||
        req.xhr
    ) {
        return res.status(404).json({ error: 'Not Found' });
    }

    // Browser navigation
    res.redirect('/error');
});


app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
