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
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

let clients = [];

wss.on('connection', (ws) => {
    clients.push(ws);
    console.log('New client connected');

    ws.on('close', () => {
        clients = clients.filter(client => client !== ws);
        console.log('Client disconnected');
    });
});

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

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);


const db = mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

db.connect(err => {
    if (err) throw err;
    console.log('Connected to database.');
});


app.post('/save-chat-query', (req, res) => {
    const { name, email, phone, question } = req.body;
    console.log(req.body); 
    // Validate incoming data (optional)
    if (!name || !email || !phone || !question) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
  
    // Insert into database
    db.query('INSERT INTO chat_queries (name, email, phone, question) VALUES (?, ?, ?, ?)', [name, email, phone, question], (error, results) => {
      if (error) {
        console.error('Error inserting chat query:', error);
        return res.status(500).json({ message: 'Failed to save query', error: error.message });
      }
      res.json({ message: 'Query saved successfully' });
    });
  });

  app.get('/admin/live-chat-queries', (req, res) => {
    // Example SQL query to retrieve live chat queries
    const sql = 'SELECT * FROM chat_queries ORDER BY id DESC';
  
    db.query(sql, (err, results) => {
      if (err) {
        console.error('Error fetching live chat queries:', err);
        res.status(500).json({ error: 'Internal Server Error' });
        return;
      }
      // Assuming results is an array of chat queries
      res.json(results);
    });
  });

// Example function using async/await with mysql2
// async function fetchAppointments() {
//     try {
//         const [rows, fields] = await db.query('SELECT * FROM appointments');
//         console.log('Appointments:', rows);
//     } catch (err) {
//         console.error('Error fetching appointments:', err);
//     }
// }

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


// Admin dashboard route filter here
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




// POST request to approve an appointment
router.post('/approve-appointment/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    const { remarks } = req.body;

    db.query('SELECT * FROM appointments WHERE id = ?', [id], (selectError, results) => {
        if (selectError) {
            console.error('Error fetching appointment:', selectError);
            return res.status(500).json({ message: 'Failed to fetch appointment', error: selectError.message });
        }

        if (results.length === 0) {
            return res.status(404).json({ message: 'Appointment not found' });
        }

        const appointment = results[0];

        db.query('INSERT INTO approved_appointments (name, address, date, slot, phone, email, city, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 
        [appointment.name, appointment.address, appointment.date, appointment.slot, appointment.phone, appointment.email, appointment.city, remarks], 
        (insertError, insertResults) => {
            if (insertError) {
                console.error('Error inserting approved appointment:', insertError);
                return res.status(500).json({ message: 'Failed to approve appointment', error: insertError.message });
            }
            else{
                console.log("OOPSY");
            }

            db.query('DELETE FROM appointments WHERE id = ?', [id], (deleteError, deleteResults) => {
                if (deleteError) {
                    console.error('Error deleting appointment:', deleteError);
                    return res.status(500).json({ message: 'Failed to delete original appointment', error: deleteError.message });
                }

                res.status(200).json({ message: 'Appointment approved successfully' });
            });
            
        });
    });
});

router.delete('/delete-appointment/:id', requireAdmin, (req, res) => {
    const { id } = req.params;

    // Fetch the slot details before deleting the appointment
    db.query('SELECT date, slot FROM appointments WHERE id = ?', [id], (selectError, selectResults) => {
        if (selectError) {
            console.error('Error fetching appointment:', selectError);
            return res.status(500).json({ message: 'Failed to fetch appointment', error: selectError.message });
        }

        if (selectResults.length === 0) {
            return res.status(404).json({ message: 'Appointment not found' });
        }

        const { date, slot } = selectResults[0];

        // Delete the appointment
        db.query('DELETE FROM appointments WHERE id = ?', [id], (deleteError, deleteResults) => {
            if (deleteError) {
                console.error('Error deleting appointment:', deleteError);
                return res.status(500).json({ message: 'Failed to delete appointment', error: deleteError.message });
            }

            // Delete the corresponding slot
            db.query('DELETE FROM slots WHERE date = ? AND slot = ?', [date, slot], (slotError, slotResults) => {
                if (slotError) {
                    console.error('Error deleting slot:', slotError);
                    return res.status(500).json({ message: 'Failed to delete slot', error: slotError.message });
                }

                res.status(200).json({ message: 'Appointment and corresponding slot deleted successfully' });
            });
        });
    });
});
module.exports = router;

router.post('/patient-history', requireAdmin, (req, res) => {
    const { name } = req.body;

    db.query('SELECT * FROM approved_appointments WHERE name = ?', [name], (error, results) => {
        if (error) {
            console.error('Error fetching patient history:', error);
            return res.status(500).json({ message: 'Failed to fetch patient history', error: error.message });
        }

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
    });
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
    host: 'smtp.gmail.com', // Update with your SMTP server
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER, // Your email username
        pass: process.env.EMAIL_PASS // Your email password
    }
});

// make function of here const mailOptions = {
//     from: process.env.EMAIL_USER,
//     to: 'akshay@movement-science.com',
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
cron.schedule('0 15 * * *', () => {
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
//sendAppointmentEmails();


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
    if (!req.session.otp_verified) {
        return res.redirect('/');
    }
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
            // res.json({ redirect: '/add-appointment' }); 

        }
        else {
            return res.status(400).json({ error: 'Slot already occupied' });
        }

        if (results.length === 0) {
            // Slot is available, send OTP
            client.verify.v2.services('VAf387b0730e86f98fd3b5f33afee65aa9')
                .verifications
                .create({ to: phone, channel: 'sms' })
                .then(verification => {
                    req.session.date = date;
                    req.session.slot = slot;
                    req.session.phone = phone;
                    req.session.otp_requested = true;
                    res.json({ redirect: '/verify-otp' });
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

    client.verify.v2.services('VAf387b0730e86f98fd3b5f33afee65aa9')
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

app.get('/appointmentsall', (req, res) => {
    db.query('SELECT * FROM appointments', (error, results) => {
        if (error) {
            console.error('Error fetching appointments:', error);
            return res.status(500).json({ message: 'Failed to fetch appointments', error: error.message });
        }
        res.render('allAppo', { appointments: results }); // Pass the results to the template
    });
});

app.post('/add-appointment', [
    body('name').trim().escape().notEmpty().withMessage('Name is required'),
    body('address').trim().escape().notEmpty().withMessage('Address is required'),
    body('email').trim().escape().notEmpty().withMessage('Email is required')
], (req, res) => {
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

    // Insert into appointments table
    db.query('INSERT INTO appointments (name, address, email, phone, city, date, slot) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [name, address, email, phone, city, date, slot], (err, results) => {
            if (err) {
                console.log('Database insert error:', err);
                return res.status(500).json({ error: 'Database insert error' });
            }

            if (results.affectedRows === 1) {
                console.log('Successfully inserted the appointment.');

                // Insert into customers table
                db.query('INSERT INTO customers (name, address, email, phone, city) VALUES (?, ?, ?, ?, ?)',
                    [name, address, email, phone, city], (customerErr, customerResults) => {
                        if (customerErr) {
                            console.log('Error inserting into customers table:', customerErr);
                            return res.status(500).json({ error: 'Error inserting into customers table' });
                        }

                        console.log('Successfully inserted into customers table:', customerResults);

                        // Insert into slots table
                        db.query('INSERT INTO slots (date, slot) VALUES (?, ?)', [date, slot], (slotErr, slotResults) => {
                            if (slotErr) {
                                console.log('Error inserting into slots table:', slotErr);
                                return res.status(500).json({ error: 'Error inserting into slots table' });
                            }

                            console.log('Successfully inserted into slots table:', slotResults);

                            // Assuming clients is defined elsewhere and represents a list of WebSocket clients
                            clients.forEach(client => {
                                client.send(JSON.stringify({
                                    title: 'New Appointment Added',
                                    body: `New appointment with ${name} on ${date} during ${slot}.`
                                }));
                            });

                            // Destroy the session after successful inserts
                            req.session.destroy((sessionErr) => {
                                if (sessionErr) {
                                    console.log('Session destruction error:', sessionErr);
                                    return res.status(500).json({ error: 'Session destruction error' });
                                }
                                console.log('Redirecting to /added');
                                return res.json({ redirect: '/added' });
                            });
                        });
                    });
            } else {
                console.log('Unexpected number of affected rows:', results.affectedRows);
                return res.status(500).json({ error: 'Unexpected number of affected rows' });
            }
        });
});

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

app.get('/howhelp/balance', (req, res) => {
    res.render(path.join(__dirname, 'views/howhelp/return'));
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

app.get('/howhelp/mobility', (req, res) => {
    res.render(path.join(__dirname, 'views/howhelp/mobility'));
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


app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
