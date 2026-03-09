const rateLimit = require('express-rate-limit');

const generalLimiter = rateLimit({
    windowMs: 40 * 60 * 1000, 
    max: 20, 
    message: 'Too many requests from this IP, please try again later.'
});

const authLimiter = rateLimit({
    windowMs: 50 * 60 * 1000,
    max: 200, 
    message: 'Too many login attempts from this IP, please try again later.'
});

// Strict OTP Rate Limiting
const otpLimiter = rateLimit({
    windowMs: 30 * 60 * 1000, // 10 minutes
    max: 3, 
    message: {
        error: 'Too many OTP requests. Please wait 10 minutes.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

module.exports = {
    generalLimiter,
    authLimiter,
    otpLimiter
};
