function errorHandler(err, req, res, next) {
    console.error('Unhandled Error:', {
        message: err.message,
        stack: process.env.NODE_ENV === 'production' ? '🥞' : err.stack,
        path: req.path,
        method: req.method
    });

    if (res.headersSent) {
        return next(err);
    }

    const status = err.status || 500;
    if (
        req.headers.accept?.includes('application/json') ||
        req.headers['content-type']?.includes('application/json') ||
        req.xhr
    ) {
        return res.status(status).json({
            error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message
        });
    }

    res.status(status).redirect('/error');
}

module.exports = errorHandler;
