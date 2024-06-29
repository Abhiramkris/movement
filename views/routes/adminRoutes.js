const express = require('express');
const router = express.Router();
const db = require('../models/db'); // Your database connection module
const bcrypt = require('bcrypt');
const { io } = require('../app'); // Import Socket.IO instance

// Middleware to check admin authentication
const requireAdmin = (req, res, next) => {
  if (req.session.isAdminLoggedIn) {
    next();
  } else {
    res.redirect('/admin/login');
  }
};

// Admin dashboard route
router.get('/dashboard', requireAdmin, async (req, res) => {
  try {
    const appointments = await db.query('SELECT * FROM appointments ORDER BY date ASC');
    res.render('admin/dashboard', { appointments });
  } catch (err) {
    console.error('Error fetching appointments:', err);
    res.status(500).send('Internal Server Error');
  }
});

// Admin create appointment route
router.post('/create-appointment', requireAdmin, async (req, res) => {
  try {
    const { name, address, date, slot, phone, email, city } = req.body;
    await db.query('INSERT INTO appointments (name, address, date, slot, phone, email, city) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, address, date, slot, phone, email, city]);

    // Emit new appointment event to connected clients
    io.emit('newAppointment', { name, date, slot, phone, email, city });

    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('Database insert error:', err);
    res.status(500).send('Database insert error');
  }
});

module.exports = router;
