/******************************************************************
 * CORE SETUP
 ******************************************************************/
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
const dotenv = require('dotenv');
const http = require('http');
const WebSocket = require('ws');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');

dotenv.config();

const app = express();
const port = process.env.PORT || 3200;
const server = http.createServer(app);

/******************************************************************
 * WEBSOCKET SETUP
 ******************************************************************/
const wss = new WebSocket.Server({ server });
let clients = [];

// Database Table Initialization
(async () => {
    const db = require('./config/db');
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS reschedule_requests (
                id INT AUTO_INCREMENT PRIMARY KEY,
                appointment_id INT NOT NULL,
                appointment_table VARCHAR(50) NOT NULL,
                patient_name VARCHAR(255),
                patient_phone VARCHAR(20),
                \`current_date\` DATE,
                \`current_slot\` VARCHAR(50),
                requested_date DATE NOT NULL,
                requested_slot VARCHAR(50) NOT NULL,
                reason TEXT,
                status ENUM('pending','approved','rejected') DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Reschedule requests table initialized');
    } catch (err) {
        console.error('❌ Failed to initialize reschedule_requests table:', err);
    }
})();

wss.on('connection', ws => {
    clients.push(ws);
    ws.on('close', () => {
        clients = clients.filter(c => c !== ws);
    });
});

app.locals.notifyClients = (message) => {
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
};

/******************************************************************
 * MIDDLEWARE
 ******************************************************************/
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            "script-src": ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://code.jquery.com", "https://stackpath.bootstrapcdn.com", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
            "script-src-attr": ["'self'", "'unsafe-inline'"],
            "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com", "https://stackpath.bootstrapcdn.com", "https://cdn.jsdelivr.net"],
            "font-src": ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            "img-src": ["'self'", "data:", "https://*", "http://*"],
            "connect-src": ["'self'", "ws:", "wss:", "https://*"],
        },
    },
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const sessionSecret = process.env.SESSION_SECRET || 'fallback-random-secret';
app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

/******************************************************************
 * ROUTES
 ******************************************************************/
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const appointmentRoutes = require('./routes/appointments');

app.use('/', publicRoutes);
app.use('/', appointmentRoutes);
app.use('/admin', adminRoutes);

/******************************************************************
 * ERROR HANDLING
 ******************************************************************/
const errorHandler = require('./middleware/errorHandler');

app.use((req, res) => {
    res.status(404).render('error');
});

app.use(errorHandler);

/******************************************************************
 * SERVER START
 ******************************************************************/
server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
