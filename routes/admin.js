const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { requireAdmin } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { body, validationResult } = require('express-validator');
const { normalizePhone } = require('../utils/helpers');

// Login
router.get('/login', (req, res) => {
    res.render('admin/login');
});

router.post('/login',
    authLimiter,
    [
        body('username').trim().notEmpty().withMessage('Username is required').escape(),
        body('password').trim().notEmpty().withMessage('Password is required')
    ],
    (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            if (req.xhr || req.headers.accept.indexOf('json') > -1) {
                return res.status(400).json({ errors: errors.array() });
            }
            return res.status(400).send('Validation failed');
        }

        const { username, password } = req.body;

        if (
            username === process.env.ADMIN_USERNAME &&
            password === process.env.ADMIN_PASSWORD
        ) {
            req.session.isAdmin = true;

            const token = jwt.sign(
                { role: 'admin' },
                process.env.JWT_SECRET || 'movement-science-jwt-secret-fallback',
                { expiresIn: '12h' }
            );

            res.cookie('admin_jwt', token, {
                httpOnly: true,
                sameSite: 'strict',
                secure: process.env.NODE_ENV === 'production'
            });

            if (req.xhr || req.headers.accept.indexOf('json') > -1) {
                return res.json({ redirect: '/admin/dashboard' });
            }
            return res.redirect('/admin/dashboard');
        }

        if (req.xhr || req.headers.accept.indexOf('json') > -1) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        res.status(401).send('Invalid credentials. <a href="/admin/login">Try again</a>');
    });

router.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('admin_jwt');
        res.redirect('/admin/login');
    });
});

// Dashboard
router.get('/dashboard', requireAdmin, async (req, res) => {
    const filterDate = req.query.date || '';
    let query = 'SELECT * FROM appointments';
    const queryParams = [];

    if (filterDate) {
        query += ' WHERE date = ?';
        queryParams.push(filterDate);
    }

    try {
        const [results] = await db.query(query, queryParams);
        res.render('admin/dashboard', { appointments: results, filterDate });
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch appointments' });
    }
});

// REST APIs for New Dashboard

// Fetch all appointments (for Calendar & Dashboard)
router.get('/api/appointments', requireAdmin, async (req, res) => {
    try {
        const [pending] = await db.query('SELECT * FROM appointments ORDER BY date ASC, slot ASC');
        const [approved] = await db.query('SELECT * FROM approved_appointments ORDER BY date ASC, slot ASC');

        // Prefix IDs to handle overlapping ranges between tables
        const pendingWithStatus = pending.map(a => ({ ...a, id: `req_${a.id}`, status: 'pending' }));
        const approvedWithStatus = approved.map(a => ({ ...a, id: `appt_${a.id}` }));

        const allAppointments = [...pendingWithStatus, ...approvedWithStatus];

        res.json(allAppointments);
    } catch (err) {
        console.error('Error fetching appointments API:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Bulk delete past pending appointments
router.post('/api/appointments/delete-past', requireAdmin, async (req, res) => {
    try {
        const [result] = await db.query('DELETE FROM appointments WHERE date < CURDATE()');
        res.json({ message: 'Success', deletedCount: result.affectedRows });
    } catch (err) {
        console.error('Error deleting past appointments:', err);
        res.status(500).json({ error: 'Database error while deleting past appointments' });
    }
});

// Patient History by Phone (Trail)
router.get('/api/patient/:phone/history', requireAdmin, async (req, res) => {
    const { phone } = req.params;
    if (!phone) return res.status(400).json({ error: 'Phone number required' });

    try {
        const normalizedPhone = normalizePhone(phone);
        // Fetch all past approved appointments for this phone
        const [visits] = await db.query(
            'SELECT * FROM approved_appointments WHERE phone = ? ORDER BY date DESC',
            [normalizedPhone]
        );
        res.json(visits);
    } catch (err) {
        console.error('Error fetching patient history:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Update Trial Notes / Status
router.post('/api/appointment/:id/notes',
    requireAdmin,
    [
        body('clinical_notes.s').trim().optional({ checkFalsy: true }),
        body('clinical_notes.o').trim().optional({ checkFalsy: true }),
        body('clinical_notes.ap').trim().optional({ checkFalsy: true }),
        body('date').trim().optional({ checkFalsy: true }),
        body('slot').trim().optional({ checkFalsy: true }),
        body('status').trim().notEmpty().withMessage('Status is required')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { id: rawId } = req.params;
        const { clinical_notes, status, date, slot } = req.body;
        console.log('Update Request:', { rawId, status, hasNotes: !!clinical_notes });

        try {
            let tableName = 'approved_appointments';
            let actualId = rawId;

            if (typeof rawId === 'string' && rawId.includes('req_')) {
                tableName = 'appointments';
                actualId = rawId.replace(/req_/g, '');
            } else if (typeof rawId === 'string' && rawId.includes('appt_')) {
                tableName = 'approved_appointments';
                actualId = rawId.replace(/appt_/g, '');
            }

            let updateQuery = `UPDATE ${tableName} SET `;
            const queryParams = [];
            const updates = [];

            // Only update clinical_notes and status for approved appointments
            if (tableName === 'approved_appointments') {
                if (clinical_notes) {
                    updates.push('clinical_notes = ?');
                    queryParams.push(JSON.stringify(clinical_notes));
                }
                if (status) {
                    updates.push('status = ?');
                    queryParams.push(status);
                }
            }

            // Both tables support date and slot (for rescheduling)
            if (date) {
                updates.push('date = ?');
                queryParams.push(date);
            }
            if (slot) {
                updates.push('slot = ?');
                queryParams.push(slot);
            }

            if (updates.length === 0) return res.status(400).json({ error: 'No data to update' });

            updateQuery += updates.join(', ') + ' WHERE id = ?';
            queryParams.push(actualId);

            await db.query(updateQuery, queryParams);

            // Fetch patient info for notification if date/slot changed
            if (date || slot) {
                const [target] = await db.query(`SELECT name, email, date, slot FROM ${tableName} WHERE id = ?`, [actualId]);
                if (target && target[0] && target[0].email) {
                    const appt = target[0];
                    const emailService = require('../utils/email');
                    emailService.sendStatusUpdate(appt.email, appt.name, appt.date, appt.slot, 'rescheduled', {
                        id: actualId,
                        table: tableName,
                        phone: appt.phone || (target[0].phone) // Ensure phone is passed
                    }).catch(e => console.error("Reschedule email err:", e));
                }
            }

            res.json({ message: 'Record updated successfully', type: tableName });
        } catch (err) {
            console.error('Error updating appointment notes:', err);
            res.status(500).json({ error: 'Database error' });
        }
    });

// Approve Appointment
router.post('/approve', requireAdmin, async (req, res) => {
    let { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Missing appointment ID' });

    // Handle prefixed IDs from UI
    if (typeof id === 'string' && id.includes('req_')) {
        id = id.replace(/req_/g, '');
    }

    try {
        // Move from appointments to approved_appointments
        const [pending] = await db.query('SELECT * FROM appointments WHERE id = ?', [id]);
        if (!pending || pending.length === 0) return res.status(404).json({ error: 'Not found' });

        const appt = pending[0];
        await db.query(
            'INSERT INTO approved_appointments (date, slot, phone, name, address, email, city) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [appt.date, appt.slot, appt.phone, appt.name, appt.address, appt.email, appt.city]
        );
        await db.query('DELETE FROM appointments WHERE id = ?', [id]);

        // Trigger Email (Non-blocking)
        const emailService = require('../utils/email');
        emailService.sendStatusUpdate(appt.email, appt.name, appt.date, appt.slot, 'approved', {
            id: appt.id,
            table: 'approved_appointments',
            phone: appt.phone
        }).catch(e => console.error("Email err:", e));

        res.json({ message: 'Approved successfully' });
    } catch (err) {
        console.error('Approve error:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Delete Appointment// Delete Request
router.post('/delete', requireAdmin, async (req, res) => {
    let { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Missing appointment ID' });

    try {
        let tableName = 'appointments';
        let actualId = id;

        if (typeof id === 'string' && id.includes('req_')) {
            tableName = 'appointments';
            actualId = id.replace(/req_/g, '');
        } else if (typeof id === 'string' && id.includes('appt_')) {
            tableName = 'approved_appointments';
            actualId = id.replace(/appt_/g, '');
        }

        // Fetch to get email/name for notification before delete
        const [target] = await db.query(`SELECT * FROM ${tableName} WHERE id = ?`, [actualId]);
        if (!target || target.length === 0) return res.status(404).json({ error: 'Not found' });

        const appt = target[0];

        // Delete
        await db.query(`DELETE FROM ${tableName} WHERE id = ?`, [actualId]);
        await db.query('DELETE FROM slots WHERE date = ? AND slot = ?', [appt.date, appt.slot]);

        // Trigger Email (Non-blocking)
        const emailService = require('../utils/email');
        emailService.sendStatusUpdate(appt.email, appt.name, appt.date, appt.slot, 'cancelled')
            .catch(e => console.error("Email err:", e));
        res.json({ message: 'Deleted successfully' });
    } catch (err) {
        console.error('Delete error:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Call Requests Page
router.get('/call', requireAdmin, async (req, res) => {
    try {
        const [results] = await db.query('SELECT * FROM call_requests ORDER BY created_at DESC, id DESC');
        res.render('admin/caller', { callRequests: results });
    } catch (err) {
        res.status(500).send('Database error');
    }
});

// Update Call Request Status
router.post('/call/status/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const validStatuses = ['new', 'contacted', 'follow_up', 'resolved'];

    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    try {
        const [result] = await db.query('UPDATE call_requests SET status = ? WHERE id = ?', [status, id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Request not found' });
        res.json({ success: true, message: `Status updated to ${status}` });
    } catch (err) {
        console.error('Error updating call request status:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Reply to Call Request via Email
router.post('/call/reply/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { message } = req.body;

    if (!message || !message.trim()) {
        return res.status(400).json({ error: 'Reply message is required' });
    }

    try {
        const [rows] = await db.query('SELECT * FROM call_requests WHERE id = ?', [id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Request not found' });

        const request = rows[0];
        if (!request.email) return res.status(400).json({ error: 'No email address for this request' });

        const emailService = require('../utils/email');
        await emailService.sendCallRequestReply(request.email, request.name || 'Valued Patient', message.trim());

        // Auto-update status to contacted
        await db.query("UPDATE call_requests SET status = 'contacted' WHERE id = ? AND status = 'new'", [id]);

        res.json({ success: true, message: 'Reply sent successfully' });
    } catch (err) {
        console.error('Error sending call request reply:', err);
        res.status(500).json({ error: 'Failed to send reply' });
    }
});

// Delete Call Request
router.post('/call/delete/:id', requireAdmin, async (req, res) => {
    try {
        await db.query('DELETE FROM call_requests WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Deleted successfully' });
    } catch (err) {
        console.error('Error deleting call request:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ──────────────────────────────────────────────
// SETTINGS
// ──────────────────────────────────────────────

router.post('/api/settings', requireAdmin, async (req, res) => {
    try {
        const { key, value } = req.body;
        if (!key || value === undefined) return res.status(400).json({ error: 'Key and value required' });

        await db.query(
            'INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            [key, value, value]
        );
        res.json({ success: true, message: 'Settings saved' });
    } catch (err) {
        console.error('Error saving settings:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Helper to get a setting
async function getSetting(key, defaultValue = null) {
    try {
        const [rows] = await db.query('SELECT setting_value FROM app_settings WHERE setting_key = ?', [key]);
        return rows.length ? rows[0].setting_value : defaultValue;
    } catch (e) {
        return defaultValue;
    }
}

// ──────────────────────────────────────────────
// PATIENT CENTER
// ──────────────────────────────────────────────

// Render Patient Center page
router.get('/patients', requireAdmin, async (req, res) => {
    try {
        const groupingPref = await getSetting('patient_grouping');
        const needsGroupingPreference = !groupingPref;

        // Define grouping logic based on preference
        let groupBy = 'phone, name, email, city';
        let whereClause = "phone IS NOT NULL AND phone != ''";

        if (groupingPref === 'email') {
            groupBy = 'email, name, phone, city';
            whereClause = "email IS NOT NULL AND email != ''";
        } else if (groupingPref === 'both') {
            groupBy = 'phone, email, name, city';
            whereClause = "(phone IS NOT NULL AND phone != '') OR (email IS NOT NULL AND email != '')";
        }

        // Get unique patients from approved_appointments (most complete records)
        const [patients] = await db.query(`
            SELECT name, phone, email, city,
                   COUNT(*) as total_visits,
                   MAX(date) as last_visit,
                   MIN(date) as first_visit
            FROM approved_appointments
            WHERE ${whereClause}
            GROUP BY ${groupBy}
            ORDER BY last_visit DESC
        `);
        res.render('admin/patients', { patients, needsGroupingPreference, currentGrouping: groupingPref });
    } catch (err) {
        console.error('Error fetching patients:', err);
        res.status(500).send('Database error');
    }
});

// Search patients API
router.get('/api/patients/search', requireAdmin, async (req, res) => {
    const q = req.query.q || '';
    if (!q.trim()) return res.json([]);

    try {
        const searchTerm = `%${q.trim()}%`;
        const groupingPref = await getSetting('patient_grouping') || 'phone';

        let groupBy = 'phone, name, email, city';
        let whereClause = "phone IS NOT NULL AND phone != ''";
        let callWhereClause = "phone NOT IN (SELECT DISTINCT phone FROM approved_appointments WHERE phone IS NOT NULL)";
        let callGroupBy = 'phone, name, email';

        if (groupingPref === 'email') {
            groupBy = 'email, name, phone, city';
            whereClause = "email IS NOT NULL AND email != ''";
            callWhereClause = "email NOT IN (SELECT DISTINCT email FROM approved_appointments WHERE email IS NOT NULL)";
            callGroupBy = 'email, name, phone';
        } else if (groupingPref === 'both') {
            groupBy = 'phone, email, name, city';
            whereClause = "(phone IS NOT NULL AND phone != '') OR (email IS NOT NULL AND email != '')";
            callWhereClause = "phone NOT IN (SELECT DISTINCT phone FROM approved_appointments WHERE phone IS NOT NULL) AND email NOT IN (SELECT DISTINCT email FROM approved_appointments WHERE email IS NOT NULL)";
            callGroupBy = 'phone, email, name';
        }

        const [patients] = await db.query(`
            SELECT name, phone, email, city,
                   COUNT(*) as total_visits,
                   MAX(date) as last_visit
            FROM approved_appointments
            WHERE (name LIKE ? OR phone LIKE ? OR email LIKE ?)
              AND (${whereClause})
            GROUP BY ${groupBy}
            ORDER BY last_visit DESC
            LIMIT 50
        `, [searchTerm, searchTerm, searchTerm]);

        // Also check call_requests for patients not in appointments
        const [callPatients] = await db.query(`
            SELECT name, phone, email, 'call_request' as source
            FROM call_requests
            WHERE (name LIKE ? OR phone LIKE ? OR email LIKE ?)
              AND (${callWhereClause})
            GROUP BY ${callGroupBy}
            LIMIT 20
        `, [searchTerm, searchTerm, searchTerm]);

        const combined = [...patients, ...callPatients.map(cp => ({
            ...cp, total_visits: 0, last_visit: null, city: ''
        }))];

        res.json(combined);
    } catch (err) {
        console.error('Error searching patients:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get patient detail by identifier (phone or email depending on grouping)
router.get('/api/patients/:identifier/detail', requireAdmin, async (req, res) => {
    const identifier = req.params.identifier;
    try {
        const groupingPref = await getSetting('patient_grouping') || 'phone';
        let matchField = 'phone';
        let normalizedId = identifier;

        if (groupingPref === 'phone') {
            normalizedId = normalizePhone(identifier);
        } else if (groupingPref === 'email' && identifier.includes('@')) {
            matchField = 'email';
        } else if (groupingPref === 'both') {
            // Heuristic: if it has @ it's an email, else treat as phone
            if (identifier.includes('@')) {
                matchField = 'email';
            } else {
                normalizedId = normalizePhone(identifier);
            }
        } else {
            // Fallback for safety if somehow phone is passed when email is default
            normalizedId = normalizePhone(identifier);
        }

        // Get all approved appointments
        const [appointments] = await db.query(
            `SELECT * FROM approved_appointments WHERE ${matchField} = ? ORDER BY date DESC`,
            [normalizedId]
        );

        // Get pending appointments
        const [pending] = await db.query(
            `SELECT *, 'pending' as appt_status FROM appointments WHERE ${matchField} = ? ORDER BY date DESC`,
            [normalizedId]
        );

        // Get call requests
        const [calls] = await db.query(
            `SELECT * FROM call_requests WHERE ${matchField} = ? ORDER BY created_at DESC`,
            [normalizedId]
        );

        res.json({ appointments, pending, calls });
    } catch (err) {
        console.error('Error fetching patient detail:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ──────────────────────────────────────────────
// NOTIFICATION CENTER
// ──────────────────────────────────────────────

// Render Notification Center page
router.get('/notifications', requireAdmin, async (req, res) => {
    try {
        const [groups] = await db.query('SELECT g.*, COUNT(m.id) as member_count FROM email_groups g LEFT JOIN email_group_members m ON g.id = m.group_id GROUP BY g.id, g.name, g.description, g.created_at ORDER BY g.created_at DESC');
        const [log] = await db.query('SELECT * FROM email_log ORDER BY sent_at DESC LIMIT 50');
        const [patients] = await db.query(`
            SELECT DISTINCT name, email, phone FROM (
                SELECT name COLLATE utf8mb4_unicode_ci as name, 
                       email COLLATE utf8mb4_unicode_ci as email, 
                       phone COLLATE utf8mb4_unicode_ci as phone 
                FROM approved_appointments WHERE email IS NOT NULL AND email != ''
                UNION
                SELECT name COLLATE utf8mb4_unicode_ci as name, 
                       email COLLATE utf8mb4_unicode_ci as email, 
                       phone COLLATE utf8mb4_unicode_ci as phone 
                FROM call_requests WHERE email IS NOT NULL AND email != ''
            ) as all_patients ORDER BY name
        `);
        res.render('admin/notifications', { groups, log, patients });
    } catch (err) {
        console.error('Error loading notification center:', err);
        res.status(500).send('Database error');
    }
});

// Send individual email
router.post('/api/notifications/send', requireAdmin, async (req, res) => {
    const { email, name, subject, message } = req.body;
    if (!email || !subject || !message) {
        return res.status(400).json({ error: 'Email, subject, and message are required' });
    }

    try {
        const emailService = require('../utils/email');
        await emailService.sendCustomEmail(email, name || '', subject, message);

        await db.query(
            'INSERT INTO email_log (recipient_email, recipient_name, subject, message, type) VALUES (?,?,?,?,?)',
            [email, name || '', subject, message, 'individual']
        );

        res.json({ success: true, message: 'Email sent successfully' });
    } catch (err) {
        console.error('Error sending notification:', err);
        await db.query(
            'INSERT INTO email_log (recipient_email, recipient_name, subject, message, type, status) VALUES (?,?,?,?,?,?)',
            [email, name || '', subject, message, 'individual', 'failed']
        ).catch(() => { });
        res.status(500).json({ error: 'Failed to send email' });
    }
});

// Send group email
router.post('/api/notifications/send-group', requireAdmin, async (req, res) => {
    const { group_id, subject, message } = req.body;
    if (!group_id || !subject || !message) {
        return res.status(400).json({ error: 'Group, subject, and message are required' });
    }

    try {
        const [members] = await db.query('SELECT * FROM email_group_members WHERE group_id = ?', [group_id]);
        const [group] = await db.query('SELECT name FROM email_groups WHERE id = ?', [group_id]);
        if (!members.length) return res.status(400).json({ error: 'Group has no members' });

        const emailService = require('../utils/email');
        let sent = 0, failed = 0;

        for (const member of members) {
            try {
                await emailService.sendCustomEmail(member.email, member.name || '', subject, message);
                await db.query(
                    'INSERT INTO email_log (recipient_email, recipient_name, subject, message, type, group_name) VALUES (?,?,?,?,?,?)',
                    [member.email, member.name || '', subject, message, 'group', group[0]?.name || '']
                );
                sent++;
            } catch (e) {
                failed++;
                await db.query(
                    'INSERT INTO email_log (recipient_email, recipient_name, subject, message, type, group_name, status) VALUES (?,?,?,?,?,?,?)',
                    [member.email, member.name || '', subject, message, 'group', group[0]?.name || '', 'failed']
                ).catch(() => { });
            }
        }

        res.json({ success: true, message: `Sent to ${sent}/${sent + failed} members` });
    } catch (err) {
        console.error('Error sending group email:', err);
        res.status(500).json({ error: 'Failed to send group email' });
    }
});

// Create email group
router.post('/api/notifications/groups', requireAdmin, async (req, res) => {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Group name is required' });

    try {
        const [result] = await db.query('INSERT INTO email_groups (name, description) VALUES (?,?)', [name, description || '']);
        res.json({ success: true, id: result.insertId, message: 'Group created' });
    } catch (err) {
        console.error('Error creating group:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get group members
router.get('/api/notifications/groups/:id/members', requireAdmin, async (req, res) => {
    try {
        const [members] = await db.query('SELECT * FROM email_group_members WHERE group_id = ? ORDER BY added_at DESC', [req.params.id]);
        res.json(members);
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

// Middleware to ensure unique emails in a batch request
const ensureUniqueEmails = (req, res, next) => {
    let { members } = req.body;

    // Support legacy single add mode
    if (!members && req.body.email) {
        members = [{ email: req.body.email, name: req.body.name }];
    }

    if (!members || !Array.isArray(members)) {
        return res.status(400).json({ error: 'Invalid members payload' });
    }

    // Deduplicate incoming list by email
    const uniqueMap = new Map();
    members.forEach(m => {
        if (m.email) {
            const lowerEmail = m.email.toLowerCase().trim();
            if (!uniqueMap.has(lowerEmail)) {
                uniqueMap.set(lowerEmail, { email: lowerEmail, name: m.name || '' });
            }
        }
    });

    req.uniqueMembers = Array.from(uniqueMap.values());
    next();
};

// Add members to group (Bulk)
router.post('/api/notifications/groups/:id/members', requireAdmin, ensureUniqueEmails, async (req, res) => {
    const groupId = req.params.id;
    const members = req.uniqueMembers;

    if (members.length === 0) return res.status(400).json({ error: 'No valid emails provided' });

    try {
        // Fetch existing emails in the group
        const [existingRows] = await db.query('SELECT email FROM email_group_members WHERE group_id = ?', [groupId]);
        const existingEmails = new Set(existingRows.map(r => r.email.toLowerCase()));

        // Filter out those already in the group
        const toInsert = members.filter(m => !existingEmails.has(m.email));

        if (toInsert.length === 0) {
            return res.json({ success: true, message: 'All provided members are already in the group' });
        }

        // Bulk insert
        const values = toInsert.map(m => [groupId, m.email, m.name]);
        const placeholders = toInsert.map(() => '(?, ?, ?)').join(', ');
        const flatValues = values.reduce((acc, val) => acc.concat(val), []);

        await db.query(`INSERT INTO email_group_members (group_id, email, name) VALUES ${placeholders}`, flatValues);

        res.json({ success: true, message: `Added ${toInsert.length} member(s)` });
    } catch (err) {
        console.error('Error adding group members:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Remove member from group
router.post('/api/notifications/groups/:id/members/remove', requireAdmin, async (req, res) => {
    const { member_id } = req.body;
    try {
        await db.query('DELETE FROM email_group_members WHERE id = ? AND group_id = ?', [member_id, req.params.id]);
        res.json({ success: true, message: 'Member removed' });
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

// Delete email group
router.post('/api/notifications/groups/:id/delete', requireAdmin, async (req, res) => {
    try {
        await db.query('DELETE FROM email_groups WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Group deleted' });
    } catch (err) {
        console.error('Error deleting group:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

/**
 * RESCHEDULE REQUESTS ADMIN API
 */

// Fetch all pending reschedule requests
router.get('/api/reschedule-requests', requireAdmin, async (req, res) => {
    try {
        const [requests] = await db.query(
            "SELECT * FROM reschedule_requests WHERE status = 'pending' ORDER BY created_at DESC"
        );
        res.json(requests);
    } catch (err) {
        const fs = require('fs');
        fs.appendFileSync('/tmp/admin_error.log', `Error [${new Date().toISOString()}]: ${err.stack}\n`);
        console.error('CRITICAL: Error fetching reschedule requests:', err);
        res.status(500).json({ error: 'REALLY CRITICAL DB ERROR', details: err.message });
    }
});

// Approve a reschedule request
router.post('/api/reschedule-requests/:id/approve', requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const [requestRows] = await db.query('SELECT * FROM reschedule_requests WHERE id = ?', [id]);
        if (requestRows.length === 0) return res.status(404).json({ error: 'Request not found' });

        const request = requestRows[0];
        const { appointment_id, appointment_table, requested_date, requested_slot } = request;

        // 1. Update the original appointment
        await db.query(
            `UPDATE ${appointment_table} SET date = ?, slot = ? WHERE id = ?`,
            [requested_date, requested_slot, appointment_id]
        );

        // 2. Mark request as approved
        await db.query('UPDATE reschedule_requests SET status = "approved" WHERE id = ?', [id]);

        // 3. Send confirmation email to patient
        const [apptRows] = await db.query(
            `SELECT name, email, phone FROM ${appointment_table} WHERE id = ?`,
            [appointment_id]
        );
        if (apptRows.length > 0) {
            const appt = apptRows[0];
            const emailService = require('../utils/email');
            emailService.sendStatusUpdate(appt.email, appt.name, requested_date, requested_slot, 'rescheduled', {
                id: appointment_id,
                table: appointment_table,
                phone: appt.phone
            }).catch(e => console.error('Error sending reschedule approval email:', e));
        }

        res.json({ success: true, message: 'Reschedule approved and appointment updated' });
    } catch (err) {
        console.error('Error approving reschedule:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Reject a reschedule request
router.post('/api/reschedule-requests/:id/reject', requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const [requestRows] = await db.query('SELECT * FROM reschedule_requests WHERE id = ?', [id]);
        if (requestRows.length === 0) return res.status(404).json({ error: 'Request not found' });

        const request = requestRows[0];

        // 1. Mark request as rejected
        await db.query('UPDATE reschedule_requests SET status = "rejected" WHERE id = ?', [id]);

        // 2. Notify patient (Optional: you could add a specialized email for this)
        const emailService = require('../utils/email');
        emailService.sendCustomEmail(
            request.patient_phone, // Using phone as fallback if email not in request table
            request.patient_name,
            'Reschedule Request Update',
            `Your request to reschedule your appointment to ${request.requested_date} at ${request.requested_slot} could not be accommodated at this time. Please contact us to find another suitable slot.`
        ).catch(e => console.error('Error sending reject notification:', e));

        res.json({ success: true, message: 'Reschedule request rejected' });
    } catch (err) {
        console.error('Error rejecting reschedule:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
