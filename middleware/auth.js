const jwt = require('jsonwebtoken');

function requireAdmin(req, res, next) {
    if (req.session?.isAdmin) return next();

    const token =
        req.cookies.admin_jwt ||
        req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        return res.redirect('/admin/login');
    }

    try {
        jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        res.redirect('/admin/login');
    }
}

module.exports = {
    requireAdmin
};
