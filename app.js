const express = require('express');
const bodyParser = require('body-parser');
const { body, validationResult } = require('express-validator');
const session = require('express-session');
const mysql = require('mysql2');
const path = require('path');
const twilio = require('twilio');
const dotenv = require('dotenv');
const schedule = require('node-schedule');
const axios = require('axios');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const ejs = require('ejs');
// const db = require('./models/db'); // Your database connection module
// const adminRoutes = require('./routes/adminRoutes');
const http = require('http'); // Import HTTP module
const socketIo = require('socket.io'); // Import Socket.IO module
dotenv.config(); // Load environment variables
const app = express();
const port = process.env.PORT || 3000;
const server = http.createServer(app); // Create HTTP server
const io = socketIo(server); // Initialize Socket.IO




let clients = [];

// Handle WebSocket connections
io.on('connection', (socket) => {
    clients.push(socket);

    socket.on('disconnect', () => {
        clients = clients.filter(client => client !== socket);
    });
});



app.set('view engine', 'ejs');
app.use(bodyParser.json());
app.set('views', path.join(__dirname, 'views'));
app.set('public', path.join(__dirname, 'public'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({ secret: 'secret', resave: true, saveUninitialized: true }));

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

// MySQL2 pool configuration

const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});



// Example function using async/await with mysql2
async function fetchAppointments() {
    try {
        const [rows, fields] = await db.query('SELECT * FROM appointments');
        console.log('Appointments:', rows);
    } catch (err) {
        console.error('Error fetching appointments:', err);
    }
}

//fetchAppointments();

const router = express.Router();


// Middleware function to require admin authentication
function requireAdmin(req, res, next) {
    if (req.session && req.session.isAdmin) {
        next();
    } else {
        res.status(401).json({ message: 'Unauthorized' });
    }
}

// Login route
router.get('/login', (req, res) => {
    res.render('admin/login'); // Assuming you have a login form view (e.g., login.ejs)
});

router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        // Replace with your actual username and password retrieval logic
        if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
            req.session.isAdmin = true; // Set admin session flag
            // Redirect to admin dashboard on success
            res.json({ redirect: '/admin/dashboard' });
        } else {
            // res.status(401).json({ error: 'Invalid credentials' }); // Send error response for invalid credentials

        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal Server Error' }); // Send internal server error response
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ message: 'Failed to log out' });
        }
        res.render('admin/login'); // Assuming you have a login form view (e.g., login.ejs)
    });
});


// Admin dashboard route
router.get('/dashboard', requireAdmin, (req, res) => {


    // const { date } = req.query;
    const filterDate = req.query.date || '';
    // Define the base SQL query
    let query = 'SELECT * FROM appointments';
    let queryParams = [];

    // If a date parameter is provided, add a WHERE clause to filter by date

    if (filterDate) {
        query += ' WHERE date = ?';
        queryParams.push(filterDate);
    }

    // Execute the SQL query
    db.query(query, queryParams, (error, results) => {
        if (error) {
            console.error('Error fetching appointments:', error);
            return res.status(500).json({ message: 'Failed to fetch appointments', error: error.message });
        }

        res.render('admin/dashboard', {
            appointments: results,
            filterDate: filterDate // Pass filterDate to the EJS template
        });
    });
});

module.exports = router;

// Admin calendar route


// POST request to approve an appointment
router.post('/approve-appointment/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { remarks } = req.body;

    try {
        const [selectResults, selectFields] = await db.query('SELECT * FROM appointments WHERE id = ?', [id]);
        if (selectResults.length === 0) {
            return res.status(404).json({ message: 'Appointment not found' });
        }

        const appointment = selectResults[0];

        const [insertResults, insertFields] = await db.query('INSERT INTO approved_appointments (name, address, date, slot, phone, email, city, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [appointment.name, appointment.address, appointment.date, appointment.slot, appointment.phone, appointment.email, appointment.city, remarks]);

        const [deleteResults, deleteFields] = await db.query('DELETE FROM appointments WHERE id = ?', [id]);

        res.status(200).json({ message: 'Appointment approved successfully' });
    } catch (error) {
        console.error('Error handling appointment approval:', error);
        res.status(500).json({ message: 'Failed to process appointment', error: error.message });
    }
});

router.delete('/delete-appointment/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        const [selectResults, selectFields] = await db.query('SELECT date, slot FROM appointments WHERE id = ?', [id]);
        if (selectResults.length === 0) {
            return res.status(404).json({ message: 'Appointment not found' });
        }

        const { date, slot } = selectResults[0];

        const [deleteResults, deleteFields] = await db.query('DELETE FROM appointments WHERE id = ?', [id]);
        const [deleteSlotResults, deleteSlotFields] = await db.query('DELETE FROM slots WHERE date = ? AND slot = ?', [date, slot]);

        res.status(200).json({ message: 'Appointment and corresponding slot deleted successfully' });
    } catch (error) {
        console.error('Error handling appointment deletion:', error);
        res.status(500).json({ message: 'Failed to delete appointment', error: error.message });
    }
});

module.exports = router;

router.post('/patient-history', requireAdmin, async (req, res) => {
    const { name } = req.body;

    try {
        const [results, fields] = await db.query('SELECT * FROM approved_appointments WHERE name = ?', [name]);

        const groupedAppointments = results.reduce((acc, appointment) => {
            const key = `${appointment.name}-${appointment.phone}`;
            if (!acc[key]) {
                acc[key] = {
                    name: appointment.name,
                    phone: appointment.phone,
                    address: appointment.address,
                    visits: []
                };
            }
            acc[key].visits.push({
                date: appointment.date,
                slot: appointment.slot,
                remarks: appointment.remarks
            });
            return acc;
        }, {});

        res.render('patient-history', { groupedAppointments, name });
    } catch (error) {
        console.error('Error fetching patient history:', error);
        res.status(500).json({ message: 'Failed to fetch patient history', error: error.message });
    }
});


module.exports = router;



// Admin verified appointments route
// router.get('/verified-appointments', requireAdmin, (req, res) => {
//     db.query('SELECT * FROM verified_appointments ORDER BY date ASC', (err, verifiedAppointments) => {
//         if (err) {
//             console.error('Error fetching verified appointments:', err);
//             return res.status(500).send('Internal Server Error');
//         }
//         res.render('admin/verified-appointments', { verifiedAppointments });
//     });
// });




// Mount the admin routes under /admin
app.use('/admin', router);




// Create a Nodemailer transporter using your email service
const transporter = nodemailer.createTransport({
    host: 'smtp.hostinger.email', // Update with your SMTP server
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER, // Your email username
        pass: process.env.EMAIL_PASS // Your email password
    }
});

// const mailOptions = {
//     from: process.env.EMAIL_USER,
//     to: 'kabhiram@gmail.com',
//     subject: 'Test Email',
//     text: 'This is a test email from Node.js using nodemailer.'
// };

// transporter.sendMail(mailOptions, (error, info) => {
//     if (error) {
//         console.error('Error sending email:', error);
//     } else {
//         console.log('Email sent:', info.response);
//     }
// });


// Cron job to run every day at a specified time (e.g., 8:00 AM)
cron.schedule('0 8 * * *', () => {
    sendAppointmentEmails();
});

function sendAppointmentEmails() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateString = tomorrow.toISOString().split('T')[0];

    db.query('SELECT * FROM appointments WHERE date = ?', [dateString], (err, results) => {
        if (err) {
            console.error('Database query error:', err);
            return;
        }

        if (results.length === 0) {
            console.log('No appointments for tomorrow.');
            return;
        }

        results.forEach(appointment => {
            sendEmail(appointment);
        });
    });
}

function sendEmail(appointment) {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: appointment.email, // Assuming email is a field in your appointments table
        subject: 'Your Appointment Reminder',
        html: generateEmailHtml(appointment)
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            return console.log('Error sending email:', error);
        }
        console.log('Email sent:', info.response);
    });
}

function generateEmailHtml(appointment) {
    const emailTemplate = path.join(__dirname, 'emailTemplate.ejs');
    const data = {
        name: appointment.name,
        date: appointment.date,
        slot: appointment.slot
    };

    let emailHtml;
    ejs.renderFile(emailTemplate, data, (err, str) => {
        if (err) {
            console.error('Error rendering email template:', err);
            return;
        }
        emailHtml = str;
    });

    return emailHtml;
}

// Test the function manually (optional, for debugging)
sendAppointmentEmails();


app.get('/', (req, res) => {
    // sendAppointmentEmails();
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
    res.render(path.join(__dirname, 'views/appointment'));
});

app.get('/added', (req, res) => {
    // if (!req.session.otp_verified) {
    //     return res.redirect('/');
    // }
    res.render(path.join(__dirname, 'views/add'));
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
    console.log(date);
    db.query('SELECT * FROM slots WHERE date = ? AND slot = ?', [date, slot], (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Database query error' });
        }
        if (results.length == 0) {
            console.log(results.length);
            req.session.date = date;
            req.session.slot = slot;
            req.session.phone = phone;
            req.session.city = city;
            req.session.otp_requested = true;
            res.json({ redirect: '/add-appointment' }); //remove later

        }
        else {
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

router.post('/add-appointment', [
    body('name').trim().escape().notEmpty().withMessage('Name is required'),
    body('address').trim().escape().notEmpty().withMessage('Address is required'),
    body('email').trim().escape().notEmpty().withMessage('Email is required')
], async (req, res) => {
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
        return res.status(400).json({ error: 'Session data is missing, please try again' });
    }

    try {
        await db.beginTransaction();

        const [insertResults, insertFields] = await db.query('INSERT INTO appointments (name, address, email, phone, city, date, slot) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name, address, email, phone, city, date, slot]);

        if (insertResults.affectedRows !== 1) {
            throw new Error('Failed to insert appointment');
        }

        const [customerResults, customerFields] = await db.query('INSERT INTO customers (name, address, email, phone, city) VALUES (?, ?, ?, ?, ?)',
            [name, address, email, phone, city]);

        if (customerResults.affectedRows !== 1) {
            throw new Error('Failed to insert customer');
        }

        const [slotResults, slotFields] = await db.query('INSERT INTO slots (date, slot) VALUES (?, ?)', [date, slot]);

        if (slotResults.affectedRows !== 1) {
            throw new Error('Failed to update slot availability');
        }

        await db.commit();
        req.session.destroy(); // Clear session after successful appointment

        res.status(200).json({ message: 'Appointment added successfully' });
    } catch (error) {
        await db.rollback();
        console.error('Error adding appointment:', error);
        res.status(500).json({ message: 'Failed to add appointment', error: error.message });
    }
});

app.get('/howhelp/index', (req, res) => {
    res.render(path.join(__dirname, 'views/howhelp/index1'));
});

app.get('/howhelp/recovery', (req, res) => {
    res.render(path.join(__dirname, 'views/howhelp/recovery'));
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
