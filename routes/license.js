const express = require('express');
const router = express.Router();
const axios = require('axios');
const User = require('../models/User');

router.get('/version', async (req, res) => {
    try {
        const currentVersion = process.env.VERSION || '1.3.0';
        const globalMessage = process.env.GLOBAL_MESSAGE || '';
        const showWithVersion = process.env.GLOBAL_MESSAGE_WITH_VERSION === 'true';
        
        res.json({ 
            version: currentVersion,
            message: globalMessage,
            messageWithVersion: showWithVersion
        });
    } catch (error) {
        console.error('Version check error:', error);
        res.status(500).json({ error: 'Error checking version' });
    }
});

router.post('/validate', async (req, res) => {
    try {
        const { licenseKey, email, deviceId } = req.body;
        
        console.log('Received license validation request:', { licenseKey, email, deviceId });
        
        if (!licenseKey || !email || !deviceId) {
            return res.status(400).json({
                valid: false,
                message: 'License key, email, and device ID are required'
            });
        }

        // Check key format
        const isLemonSqueezyFormat = /^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$/i.test(licenseKey);
        const isFreeKeyFormat = /^[A-F0-9]{8}-[A-F0-9]{8}-[A-F0-9]{8}-[A-F0-9]{8}-[A-F0-9]{8}$/i.test(licenseKey);

        if (!isLemonSqueezyFormat && !isFreeKeyFormat) {
            return res.json({
                valid: false,
                message: 'Invalid license key format'
            });
        }

        // Handle free key validation
        if (isFreeKeyFormat) {
            console.log('Validating free key format');
            
            // Find user by email
            const user = await User.findOne({ email: email.toLowerCase() });
            
            if (!user) {
                return res.json({
                    valid: false,
                    message: 'No user found with this email'
                });
            }

            // Find the free key in user's keys
            const freeKey = user.keys.find(k => k.key === licenseKey && k.variant_id === 'free');
            
            if (!freeKey) {
                return res.json({
                    valid: false,
                    message: 'Free license key not found for this user'
                });
            }

            // Check if device is already registered
            if (freeKey.registeredDevice) {
                if (freeKey.registeredDevice === deviceId) {
                    return res.json({
                        valid: true,
                        registeredDevice: deviceId,
                        maxDevices: 1,
                        isDeviceRegistered: true,
                        plan: 'free'
                    });
                } else {
                    return res.json({
                        valid: false,
                        message: 'This free license key is already registered to another device'
                    });
                }
            }

            // Key is valid but no device registered
            return res.json({
                valid: true,
                registeredDevice: null,
                maxDevices: 1,
                isDeviceRegistered: false,
                plan: 'free'
            });
        }

        // Handle Lemon Squeezy key validation
        console.log('Key format is LemonSqueezy');
        
        // Step 1: First validate with Lemon Squeezy
        let lemonSqueezyData;
        try {
            const lemonSqueezyResponse = await axios.post(
                'https://api.lemonsqueezy.com/v1/licenses/validate',
                { license_key: licenseKey },
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.LEMON_SQUEEZY_API_KEY}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            
            lemonSqueezyData = lemonSqueezyResponse.data;
            console.log('Lemon Squeezy validation result:', lemonSqueezyData.license_key.status);

            // Check if license is valid
            if (!lemonSqueezyData.valid) {
                return res.json({
                    valid: false,
                    message: lemonSqueezyData.error || 'Invalid license key'
                });
            }

            // Verify we have a variant_id
            if (!lemonSqueezyData.meta?.variant_id) {
                console.error('Missing variant_id in Lemon Squeezy response:', lemonSqueezyData);
                return res.status(500).json({
                    valid: false,
                    message: 'Invalid license data received'
                });
            }

            // Check if license is valid but inactive
            if (lemonSqueezyData.valid && lemonSqueezyData.license_key.status === 'inactive') {
                console.log('License is valid but inactive. Activating...');
                
                try {
                    await axios.post(
                        'https://api.lemonsqueezy.com/v1/licenses/activate',
                        { 
                            license_key: licenseKey,
                            instance_name: "Activated"
                        },
                        {
                            headers: {
                                'Authorization': `Bearer ${process.env.LEMON_SQUEEZY_API_KEY}`,
                                'Content-Type': 'application/json'
                            }
                        }
                    );
                    
                    console.log('License activated successfully');
                } catch (activationError) {
                    console.error('Failed to activate license:', activationError);
                    // Continue with validation even if activation fails
                    // The license is still valid, just inactive
                }
            } else if (lemonSqueezyData.valid && lemonSqueezyData.license_key.status !== 'active') {
                // Handle any other status that's not 'active' or 'inactive'
                console.log('License has unexpected status:', lemonSqueezyData.license_key.status);
                return res.status(400).json({
                    valid: false,
                    message: `License key is ${lemonSqueezyData.license_key.status}. Please contact support if you need assistance.`
                });
            }
        } catch (error) {
            // Create a clean error log with only relevant information
            const cleanError = {
                status: error.response?.status,
                message: error.response?.data?.error,
                licenseKey: licenseKey,
                email: email
            };
            console.error('Lemon Squeezy validation error:', cleanError);
            
            // Check if we have a response with error data
            if (error.response?.data) {
                return res.status(400).json({
                    valid: false,
                    message: error.response.data.error || 'License key validation failed'
                });
            }
            
            return res.status(400).json({
                valid: false,
                message: 'License key validation failed'
            });
        }

        // Step 2: Check if email matches
        const licenseEmail = lemonSqueezyData.meta?.customer_email;
        if (!licenseEmail || licenseEmail.toLowerCase() !== email.toLowerCase()) {
            console.log('Email mismatch:', {
                provided: email.toLowerCase(),
                expected: licenseEmail?.toLowerCase()
            });
            return res.json({
                valid: false,
                message: 'The email address does not match the license key'
            });
        }

        // Make sure we have the variant_id before proceeding
        const variantId = lemonSqueezyData.meta.variant_id.toString(); // Convert to string to ensure consistent type
        
        // Find user by email first
        let user = await User.findOne({ email: email.toLowerCase() });

        // If no user exists yet, return that the license is valid but no device is registered
        if (!user) {
            return res.json({
                valid: true,
                registeredDevice: null,
                maxDevices: 1,
                isDeviceRegistered: false,
                plan: 'pro'
            });
        }

        // Find the specific key entry
        let keyEntry = user.keys.find(k => k.variant_id === variantId);

        // If the key doesn't exist in the user's keys array, return valid but no device registered
        if (!keyEntry) {
            return res.json({
                valid: true,
                registeredDevice: null,
                maxDevices: 1,
                isDeviceRegistered: false,
                plan: 'pro'
            });
        }

        const isDeviceRegistered = keyEntry.registeredDevice === deviceId;

        return res.json({
            valid: true,
            registeredDevice: keyEntry.registeredDevice,
            maxDevices: 1,
            isDeviceRegistered: isDeviceRegistered,
            plan: 'pro'
        });

    } catch (error) {
        console.error('License validation error:', error);
        res.status(500).json({
            error: 'Error validating license',
            details: error.message
        });
    }
});

module.exports = router; 