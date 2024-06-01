const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql');
const { body, validationResult } = require('express-validator');
const app = express();
const twilio = require('twilio');
const crypto = require('crypto');
const moment = require('moment');
// Middleware to parse JSON bodies
app.use(bodyParser.json());

// Create a connection to the database
const connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'movement'
});

// Connect to the database
connection.connect(err => {
    if (err) {
        console.error('Database connection failed:', err.stack);
        return;
    }
    console.log('Connected to database.');
});

// Middleware for sanitizing and validating input
const appointmentValidation = [
    body('name')
        .trim()
        .escape()
        .notEmpty().withMessage('Name is required')
        .isLength({ min: 4 }).withMessage('Name must be at least 1 character long'),
    
];

const slotValidation = [
    body('date')
        .isISO8601().withMessage('Date must be a valid date')
        .custom((value, { req }) => {
            const inputDate = new Date(value);
            const currentDate = new Date();
            currentDate.setHours(0, 0, 0, 0); // Set time to 00:00:00 for accurate comparison

            if (inputDate < currentDate) {
                
                throw new Error('Date cannot be in the past');
                
            }

            req.dayy = value;
            return true;
        }),
    body('slot').notEmpty().withMessage('Slot is required')
];


app.get('/checkslot', (req, res) => {
    res.sendFile(__dirname + '/checkslot.html'); // Serve the index.html file
});

app.post('/checkslot', slotValidation, (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
}, checkSlotAvailability, (req, res) => {
    const { date, slot, phoneNumber} = req.body;

}

);


// Middleware to check slot availability
function checkSlotAvailability(req, res, next) {
    const { dayy } = req;
    const { slot } = req.body;

    const query = 'SELECT * FROM slots WHERE date = ? AND slot = ?';
    connection.query(query, [dayy, slot], (error, results) => {
        if (error) {
            return res.status(500).json({ error: 'Database query error' });
        }

        if (results.length == 0) {
            // Slot is available
            const sql = `INSERT INTO slots (date,slot) VALUES (?,?)`;
            const values = [dayy,slot];
            connection.query(sql, values, (err, result) => {
                if (err) {
                    console.error('Error executing query:', err);
                    return res.status(500).send('Error adding appointment');
                }
                //res.send('Appointment added successfully!');
                res.json({ redirect: '/otpverify' }); // no sql here only this here 
               console.log(req.body);
            });
            next();


        } else {
            // Slot is not available
            console.log(results.length);
            res.status(400).json({ error: 'Slot not available for the selected date' });
            // console.log('Day:', dayy);
            // console.log('Slot:', slot);
        }
    });

}


// otp vrification

app.get('/otpverify', (req, res) => {
    res.sendFile(__dirname + '/otpverify.html'); // Serve the index.html file
});

const twilioClient = new twilio('AC88f6df43e1834524971acfa529c81880', 'b87bbd560305a012d4e27d55e5e54758');

const OTP_EXPIRATION_MINUTES = 0;

app.post('/otpverify', (req, res) => {
    const { phone, city } = req.body;
    const query = 'SELECT * FROM otps WHERE phone = ?';
    connection.query(query, [phone], (error, results) => {
        if (error) {
            return res.status(500).json({ success: false, error: 'Database error' });
        }

        if (results.length > 0) {
            const lastSent = moment(results[0].last_sent);
            const now = moment();
            const minutesSinceLastSent = now.diff(lastSent, 'minutes');

            if (minutesSinceLastSent < OTP_EXPIRATION_MINUTES) {
                return res.status(429).json({ success: false, error: `Please wait ${OTP_EXPIRATION_MINUTES - minutesSinceLastSent} more minutes before requesting a new OTP` });
            }
        }

        const otp = crypto.randomInt(100000, 999999).toString();

        const upsertQuery = `
            INSERT INTO otps (phone, otp, last_sent)
            VALUES (?, ?, NOW())
            ON DUPLICATE KEY UPDATE otp = VALUES(otp), last_sent = VALUES(last_sent)
        `;
        connection.query(upsertQuery, [phone, otp], (error, results) => {
            if (error) {
                return res.status(500).json({ success: false, error: 'Database error' });
            }

            twilioClient.messages.create({
                body: `Your OTP is ${otp}`,
                from: '+15204770942',
                to: phone
            }).then(message => {
                res.json({ success: true });
            }).catch(err => {
                console.error('Failed to send OTP:', err);
                res.status(500).json({ success: false, error: 'Failed to send OTP' });
            });
        });
    });
});

app.post('/verify-otp', (req, res) => {
    const { phone, otp } = req.body;

    const query = 'SELECT * FROM otps WHERE phone = ? AND otp = ?';
    connection.query(query, [phone, otp], (error, results) => {
        if (error) {
            return res.status(500).json({ success: false, error: 'Database error' });
        }

        if (results.length === 0) {
            return res.status(400).json({ success: false, error: 'Invalid OTP' });
        }

        const deleteQuery = 'DELETE FROM otps WHERE phone = ?';
        connection.query(deleteQuery, [phone], (deleteError, deleteResults) => {
            if (deleteError) {
                return res.status(500).json({ success: false, error: 'Database error' });
            }

            const insertQuery = 'INSERT INTO verified_numbers (phone, city) VALUES (?, ?)';
            connection.query(insertQuery, [phone, req.body.city], (insertError, insertResults) => {
                if (insertError) {
                    return res.status(500).json({ success: false, error: 'Database error' });
                }

                res.json({ success: true });
            });
        });
    });
});




// add-appointment sql thing  

// Use the middleware and define the checkslot route

app.get('/add-appointment', (req, res) => {
    res.sendFile(__dirname + '/appointment.html'); // Serve the index.html file
});
// Route to add appointment
app.post('/add-appointment', appointmentValidation, (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { name} = req.body;

    console.log('Request body:', req.body);

    // Insert query with prepared statement to prevent SQL injection
    const sql = `INSERT INTO appointments (name) VALUES (?)`;
    const values = [name];

    connection.query(sql, values, (err, result) => {
        if (err) {
            console.error('Error executing query:', err);
            return res.status(500).send('Error adding appointment');
        }
        res.send('Appointment added successfully!');
    });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});


