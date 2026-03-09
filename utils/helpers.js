function normalizePhone(phone) {
    if (!phone) return null;
    phone = phone.toString().replace(/[^\d+]/g, '');

    if (phone.startsWith('+91')) return phone;
    if (phone.startsWith('91') && phone.length === 12) return '+' + phone;
    if (phone.length === 10) return '+91' + phone;

    return phone;
}

module.exports = {
    normalizePhone
};
