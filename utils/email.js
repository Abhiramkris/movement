const { Resend } = require('resend');
const dotenv = require('dotenv');
dotenv.config();

// Create Resend instance (only if API key exists to prevent crashes in dev without it)
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_EMAIL = 'Movement Science <noreply@movement-science.com>'; // Update this once a domain is verified in Resend

/**
 * Base professional HTML email template
 */
const generateEmailHTML = (title, content, actionButton = null) => {
    const buttonHtml = actionButton ? `
        <div style="text-align: center; margin: 30px 0;">
            <a href="${actionButton.url}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                ${actionButton.text}
            </a>
        </div>
    ` : '';

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
    </head>
    <body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f4f6f9; margin: 0; padding: 0;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f6f9; padding: 20px 0;">
            <tr>
                <td align="center">
                    <table width="100%" max-width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); max-width: 600px; margin: 0 auto; overflow: hidden;">
                        
                        <!-- Header -->
                        <tr>
                            <td style="background-color: #011d3b; padding: 30px; text-align: center;">
                                <!-- Replace with an absolute URL to your logo if hosted -->
                                <h1 style="color: #ffffff; margin: 0; font-size: 24px; letter-spacing: 1px;">MOVEMENT SCIENCE</h1>
                            </td>
                        </tr>

                        <!-- Body -->
                        <tr>
                            <td style="padding: 40px 30px; color: #374151; font-size: 16px; line-height: 1.6;">
                                <h2 style="color: #111827; margin-top: 0; margin-bottom: 20px; font-size: 20px;">${title}</h2>
                                ${content}
                                ${buttonHtml}
                            </td>
                        </tr>

                        <!-- Footer -->
                        <tr>
                            <td style="background-color: #f8fafc; padding: 20px 30px; text-align: center; border-top: 1px solid #e2e8f0;">
                                <p style="margin: 0; color: #64748b; font-size: 14px;">
                                    &copy; ${new Date().getFullYear()} Movement Science. All rights reserved.
                                </p>
                                <p style="margin: 10px 0 0 0; color: #94a3b8; font-size: 12px;">
                                    This is an automated message, please do not reply directly to this email.
                                </p>
                            </td>
                        </tr>

                    </table>
                </td>
            </tr>
        </table>
    </body>
    </html>
    `;
};

/**
 * Send Booking Confirmation to Patient
 */
const sendBookingConfirmation = async (patientEmail, patientName, date, slot) => {
    if (!resend) return console.warn('Email skipped: No RESEND_API_KEY');

    const content = `
        <p>Dear ${patientName},</p>
        <p>Thank you for choosing Movement Science. We have successfully received your appointment request.</p>
        
        <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <p style="margin: 0 0 10px 0;"><strong>Requested Details:</strong></p>
            <p style="margin: 0; color: #166534;">
                <span style="font-weight: bold;">Date:</span> ${date.split('T')[0]}<br>
                <span style="font-weight: bold;">Time:</span> ${slot}
            </p>
        </div>
        
        <p>Our team will review your request and confirm your appointment shortly. You will receive another notification once your slot is officially approved.</p>
        <p>If you have any questions in the meantime, feel free to contact us.</p>
        <p>Best regards,<br>The Movement Science Team</p>
    `;

    try {
        await resend.emails.send({
            from: FROM_EMAIL,
            to: patientEmail,
            subject: 'Appointment Request Received - Movement Science',
            html: generateEmailHTML('Appointment Request Received', content)
        });
        console.log(`Booking confirmation sent to ${patientEmail}`);
    } catch (error) {
        console.error('Failed to send booking confirmation:', error);
    }
};

/**
 * Send New Booking Alert to Admin
 */
const sendAdminBookingAlert = async (appointmentData) => {
    if (!resend) return console.warn('Email skipped: No RESEND_API_KEY');
    const adminEmail = process.env.ADMIN_ALERT_EMAIL || 'info@movement-science.com'; // Change to actual admin email

    const content = `
        <p>A new appointment request has been submitted on the website.</p>
        
        <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
            <tr>
                <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; width: 120px;">Patient:</td>
                <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${appointmentData.name}</td>
            </tr>
            <tr>
                <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold;">Phone:</td>
                <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${appointmentData.phone}</td>
            </tr>
            <tr>
                <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold;">Date/Time:</td>
                <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #2563eb; font-weight: bold;">${appointmentData.date.split('T')[0]} @ ${appointmentData.slot}</td>
            </tr>
            <tr>
                <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold;">Location:</td>
                <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${appointmentData.address}, ${appointmentData.city}</td>
            </tr>
        </table>
        
        <p style="margin-top: 20px;">Please log in to the admin dashboard to approve or review this request.</p>
    `;

    try {
        await resend.emails.send({
            from: FROM_EMAIL,
            to: adminEmail,
            subject: `New Booking Request: ${appointmentData.name}`,
            html: generateEmailHTML('New Appointment Alert', content, { text: 'Go To Dashboard', url: 'http://movement-science.com/admin/login' }) // Update URL in prod
        });
        console.log(`Admin alert sent to ${adminEmail}`);
    } catch (error) {
        console.error('Failed to send admin alert:', error);
    }
};

/**
 * Send Status Update to Patient (Approved/Cancelled)
 */
const sendStatusUpdate = async (patientEmail, patientName, date, slot, status) => {
    if (!resend) return console.warn('Email skipped: No RESEND_API_KEY');

    const isApproved = status === 'approved';
    const title = isApproved ? 'Appointment Confirmed!' : 'Appointment Cancelled';
    const statusColor = isApproved ? '#16a34a' : '#dc2626';

    let content = `<p>Dear ${patientName},</p>`;

    if (isApproved) {
        content += `
            <p>Great news! Your physiotherapy appointment has been officially confirmed.</p>
            <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; padding: 15px; margin: 20px 0;">
                <p style="margin: 0; font-size: 18px;"><strong>${date.split('T')[0]}</strong> at <strong>${slot}</strong></p>
            </div>
            <p>Our physiotherapist will arrive at your provided location at the scheduled time. If you need to make any changes, please contact us at least 24 hours in advance.</p>
        `;
    } else {
        content += `
            <p>We regret to inform you that we are unable to fulfill your appointment request for:</p>
            <p style="color: ${statusColor}; font-weight: bold;">${date.split('T')[0]} at ${slot}</p>
            <p>Please contact us directly at our phone number or reply to this email to reschedule, and we will do our best to accommodate you.</p>
        `;
    }

    try {
        await resend.emails.send({
            from: FROM_EMAIL,
            to: patientEmail,
            subject: `${title} - Movement Science`,
            html: generateEmailHTML(title, content)
        });
        console.log(`Status update (${status}) sent to ${patientEmail}`);
    } catch (error) {
        console.error(`Failed to send status update (${status}):`, error);
    }
};

module.exports = {
    sendBookingConfirmation,
    sendAdminBookingAlert,
    sendStatusUpdate
};
