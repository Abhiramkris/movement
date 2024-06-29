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

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
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
// function requireAdmin(req, res, next) {
//     // Implement your admin authentication logic here
//     // For example, check if the user is logged in as an admin
//     // and has the necessary permissions.
//     if (req.session.isAdmin) {
//         next(); // Proceed to the next middleware or route handler
//     } else {
//         res.status(403).send('Unauthorized'); // Or redirect to login page
//     }
// }

// Middleware function to require admin authentication
    function requireAdmin(req, res, next) {
    // Implement your admin authentication logic here
    // For example, check if the user is logged in as an admin
    // and has the necessary permissions.
    if (req.session.isAdmin) {
        next(); // Proceed to the next middleware or route handler
    } else {
        res.status(403).send('Unauthorized'); // Or redirect to login page
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
// Admin dashboard route
router.get('/dashboard', requireAdmin, (req, res) => {
    // Extract the date filter from query parameters
    const { date } = req.query;

    // Define the base SQL query
    let sql = 'SELECT * FROM appointments';

    // If a date parameter is provided, add a WHERE clause to filter by date
    if (date) {
        sql += ` WHERE date = '${date}'`;
    }

    sql += ' ORDER BY date ASC';

    // Execute the SQL query
    db.query(sql, (err, appointments) => {
        if (err) {
            console.error('Error fetching appointments:', err);
            return res.status(500).send('Internal Server Error');
        }

        res.render('admin/dashboard', { appointments }); // Render the appointments to the view
    });
});

module.exports = router;

// Admin calendar route
router.get('/calendar', requireAdmin, (req, res) => {
    db.query('SELECT DISTINCT date FROM appointments ORDER BY date ASC', (err, appointmentsByDate) => {
        if (err) {
            console.error('Error fetching calendar appointments:', err);
            return res.status(500).send('Internal Server Error');
        }
        res.render('admin/calendar', { appointmentsByDate });
    });
});

// Admin verified appointments route
router.get('/verified-appointments', requireAdmin, (req, res) => {
    db.query('SELECT * FROM verified_appointments ORDER BY date ASC', (err, verifiedAppointments) => {
        if (err) {
            console.error('Error fetching verified appointments:', err);
            return res.status(500).send('Internal Server Error');
        }
        res.render('admin/verified-appointments', { verifiedAppointments });
    });
});


// router.post('/approve-appointment/:id', requireAdmin, async (req, res) => {
//     const appointmentId = req.params.id;
//     const remarks = req.body.remarks;

//     console.log('Appointment ID:', appointmentId);
//     console.log('Remarks:', remarks);

//     try {
//         // Perform update or approval logic in the database
//         await db.query('UPDATE appointments SET remarks = ? WHERE id = ?', [remarks, appointmentId]);
//         console.log(`Appointment ${appointmentId} approved with remarks: ${remarks}`);

//         // Redirect back to dashboard or respond with success message
//         res.redirect('/admin/dashboard');
//     } catch (err) {
//         console.error('Error approving appointment:', err);
//         res.status(500).send('Internal Server Error');
//     }
// });

// Route to approve appointment


router.post('/approve-appointment/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { remarks } = req.body;

    try {
        await db.query('UPDATE appointments SET remarks = ? WHERE id = ?', [remarks, appointmentId]);
        console.log(`Appointment ${appointmentId} approved with remarks: ${remarks}`);
        // Redirect back to dashboard or respond with success message
        res.redirect('/admin/dashboard');
        res.status(200).json({ message: 'Appointment approved successfully' });
    } catch (error) {
        console.error('Error approving appointment:', error);
        res.status(500).json({ message: 'Failed to approve appointment' });
    }
});

// Mount the admin routes under /admin
app.use('/admin', router);


// db.connect(err => {
//     if (err) throw err;
//     console.log('Connected to database.');
// });

// Create a Nodemailer transporter using your email service
const transporter = nodemailer.createTransport({
    service: 'hostinger', // e.g., 'gmail'
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

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
            console.log("11q");
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
                        
                            clients.forEach(client => {
                            client.send(JSON.stringify({
                                title: 'New Appointment Added',
                                body: `New appointment with ${name} on ${date} during ${slot}.`
                            }));
                        });
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

router.post('/approve-appointment/:id', requireAdmin, async (req, res) => {
    const appointmentId = req.params.id;
    try {
      // Fetch the appointment details from the appointments table
      const [appointment] = await db.query('SELECT * FROM appointments WHERE id = ?', [appointmentId]);
  
      if (!appointment) {
        return res.status(404).send('Appointment not found');
      }
  
      // Insert the appointment into the verified_appointments table
      await db.query('INSERT INTO verified_appointments (name, address, date, slot, phone, email, city, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
        appointment.name, 
        appointment.address, 
        appointment.date, 
        appointment.slot, 
        appointment.phone, 
        appointment.email, 
        appointment.city,
        req.body.remarks // Remarks added by the admin
      ]);
  
      // Optionally, delete the appointment from the appointments table
      await db.query('DELETE FROM appointments WHERE id = ?', [appointmentId]);
  
      res.redirect('/admin/dashboard');
    } catch (err) {
      console.error('Error approving appointment:', err);
      res.status(500).send('Internal Server Error');
    }
  });
  
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    console.log('connected to db')
});
