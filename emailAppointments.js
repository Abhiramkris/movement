const mysql = require('mysql');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const dotenv = require('dotenv');
const path = require('path');
const ejs = require('ejs');
const schedule = require('node-schedule');
const axios = require('axios');



dotenv.config(); // Load environment variables

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

// Create a Nodemailer transporter using your email service
const transporter = nodemailer.createTransport({
    service: 'gmail', // e.g., 'gmail'
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

// Test the function manually
//sendAppointmentEmails();

const appointmentDate = new Date(appointment.date);
const today = new Date();

// Compare appointment date with today's date
if (appointmentDate.toDateString() === today.toDateString()) {
    const j = schedule.scheduleJob('0 4 * * *', () => {
        sendBrowserNotification();
    });

}

function sendBrowserNotification() {
    // Replace with your notification content
    const notification = {
        title: 'Daily Reminder',
        body: 'Remember to check your appointments for today!'
    };

    // Example: POST request to trigger browser notification on client side
    axios.post('http://localhost:3000/send-notification', notification)
        .then(response => {
            console.log('Notification sent successfully:', response.data);
        })
        .catch(error => {
            console.error('Error sending notification:', error.message);
        });
}

console.log('Scheduler started. Notifications will be triggered daily near 4 am.');

