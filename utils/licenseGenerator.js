const crypto = require('crypto');
const User = require('../models/User');

// Function to generate a random string of specified length
function generateRandomString(length) {
    return crypto.randomBytes(length).toString('hex').toUpperCase();
}

// Function to format the license key
function formatLicenseKey(parts) {
    return parts.join('-');
}

// Function to generate a unique license key
async function generateUniqueLicenseKey() {
    // Generate a key in the format: XXXX-XXXX-XXXX-XXXX-XXXX
    // This is different from LemonSqueezy's format which is XXXX-XXXX-XXXX-XXXX
    const parts = [
        generateRandomString(4),
        generateRandomString(4),
        generateRandomString(4),
        generateRandomString(4),
        generateRandomString(4)
    ];
    
    const licenseKey = formatLicenseKey(parts);
    
    // Check if the key already exists in any user's keys
    const existingUser = await User.findOne({ 'keys.key': licenseKey });
    
    // If the key exists, generate a new one recursively
    if (existingUser) {
        return generateUniqueLicenseKey();
    }
    
    return licenseKey;
}

module.exports = {
    generateUniqueLicenseKey
}; 