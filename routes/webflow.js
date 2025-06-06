const express = require('express');
const router = express.Router();
const User = require('../models/User');
const axios = require('axios');
const nodemailer = require('nodemailer');
const { generateUniqueLicenseKey } = require('../utils/licenseGenerator');

// Create Nodemailer transporter using Gmail
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // use SSL
    auth: {
        user: 'trevor@cutpilot.io',
        pass: 'jghvxuyiexzndbon'
    }
});

// Add verification of transporter
transporter.verify(function(error, success) {
    if (error) {
        console.error('Nodemailer transporter verification failed:', {
            error: error.message,
            credentials: {
                userPresent: !!process.env.GMAIL_USER,
                passwordPresent: !!process.env.GMAIL_APP_PASSWORD,
                passwordLength: process.env.GMAIL_APP_PASSWORD?.length
            }
        });
    } else {
        console.log('Nodemailer transporter is ready to send emails');
    }
});

router.post('/verify-email', async (req, res) => {
    try {
        console.log('Raw request payload:', JSON.stringify(req.body, null, 2));
        
        // Helper function to properly capitalize names
        function capitalizeWords(str) {
            if (!str) return '';
            return str.trim().toLowerCase().split(' ')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
        }

        let { firstName, lastName, email, source } = req.body;
        
        // Clean and capitalize names
        firstName = capitalizeWords(firstName);
        lastName = capitalizeWords(lastName);
        
        console.log('Received webflow verification request:', { firstName, lastName, email, source });

        if (!email) {
            console.log('400 Bad Request: Email is missing');
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'Email is required'
            });
        }

        // Find user by email
        const user = await User.findOne({ email: email.toLowerCase() });
        
        console.log('Email verification result:', user ? 'Email exists' : 'Email does not exist');

        // Generate a unique license key
        const licenseKey = await generateUniqueLicenseKey();

        let isNewUser = false;
        let userName = firstName || '';
        
        if (user) {
            // Check if user already has a free key
            const hasFreeKey = user.keys.some(k => k.variant_id === 'free');
            
            if (hasFreeKey) {
                console.log(`400 Bad Request: Email ${email} already has a free key`);
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'This email already has a free license key.',
                    code: 'EMAIL_EXISTS'
                });
            }

            // Add free key to existing user
            user.keys.push({
                key: licenseKey,
                variant_id: 'free',
                usage: 0,
                lastReset: new Date()
            });
            await user.save();
            
            console.log('Added free key to existing user:', licenseKey);
            userName = user.firstName || firstName || '';
            
            // Send response immediately
            res.json({
                success: true,
                status: 200,
                message: 'Free license key added to existing account',
                licenseKey: licenseKey
            });
        } else {
            // Create a new user with the free key
            const newUser = await User.create({
                email: email.toLowerCase(),
                firstName: firstName,
                lastName: lastName,
                source: source || null,
                keys: [{
                    key: licenseKey,
                    variant_id: 'free',
                    usage: 0,
                    lastReset: new Date()
                }]
            });

            console.log('Created new user with free license key:', licenseKey);
            isNewUser = true;

            // Send success response immediately
            res.json({
                success: true,
                status: 200,
                message: 'Email is available for registration',
                licenseKey: licenseKey
            });
        }

        // Send email with license key - now happens for both new and existing users
        try {
            console.log('Attempting to send email with license key to:', email);
            
            await transporter.sendMail({
                from: '"CutPilot" <no-reply@cutpilot.io>',
                to: email,
                subject: 'Your CutPilot License Key',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2>Welcome to CutPilot!</h2>
                        <p>Hello ${userName},</p>
                        <p>Thank you for choosing CutPilot. Here's your license key:</p>
                        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                            <code style="font-size: 16px; color: #333;">${licenseKey}</code>
                        </div>
                        <p>To activate your license:</p>
                        <ol>
                            <li><a href="https://cutpilot.io/download" style="color: #0066cc; text-decoration: underline;">Download</a> and install the latest version of CutPilot</li>
                            <li>Open CutPilot in Adobe Premiere Pro</li>
                            <li>Enter your email address: ${email}</li>
                            <li>Enter your license key</li>
                            <li>Click "Verify License"</li>
                        </ol>
                        <p>If you need any assistance, please contact us at support@cutpilot.io</p>
                        <p>Best regards,<br>The CutPilot Team</p>
                    </div>
                `
            });
            console.log('License key email sent successfully');

            // Add notification email - fire and forget
            (async () => {
                try {
                    await transporter.sendMail({
                        from: '"CutPilot Notifications" <no-reply@cutpilot.io>',
                        to: 'trevorqualman@gmail.com',
                        subject: 'New CutPilot Signup',
                        html: `
                            <div style="font-family: Arial, sans-serif;">
                                <h3>New CutPilot User Signup</h3>
                                <p>Details:</p>
                                <ul>
                                    <li>Name: ${userName}</li>
                                    <li>Email: ${email}</li>
                                    <li>Source: ${source}</li>
                                    <li>Signup Date: ${new Date().toLocaleString()}</li>
                                </ul>
                            </div>
                        `
                    });
                } catch (notificationError) {
                    console.log('Notification email failed to send:', notificationError);
                    // Intentionally not handling the error as per request
                }
            })().catch(() => {}); // Catch any promise rejection to prevent unhandled rejection warnings

        } catch (emailError) {
            console.error('Failed to send license key email:', {
                error: emailError.message,
                stack: emailError.stack,
                email: email,
                credentials: {
                    userPresent: !!process.env.GMAIL_USER,
                    passwordPresent: !!process.env.GMAIL_APP_PASSWORD,
                    passwordLength: process.env.GMAIL_APP_PASSWORD?.length
                }
            });
        }

        // Only try to create Lemon Squeezy customer for new users
        if (isNewUser) {
            try {
                console.log('Attempting to create Lemon Squeezy customer...');
                const customerResponse = await axios.post(
                    'https://api.lemonsqueezy.com/v1/customers',
                    {
                        data: {
                            type: 'customers',
                            attributes: {
                                name: `${firstName} ${lastName}`,
                                email: email,
                                status: 'subscribed',
                                test_mode: true
                            },
                            relationships: {
                                store: {
                                    data: {
                                        type: 'stores',
                                        id: process.env.LEMON_SQUEEZY_STORE_ID
                                    }
                                }
                            }
                        }
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${process.env.LEMON_SQUEEZY_API_URL}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );

                console.log('Lemon Squeezy customer created successfully');
            } catch (customerError) {
                // Extract the actual error message if available
                const errorDetail = customerError.response?.data?.errors?.[0]?.detail;
                
                if (errorDetail?.includes('email has already been taken')) {
                    console.log('Customer already exists in Lemon Squeezy (non-critical)');
                } else {
                    // Log other errors in a clean format
                    const cleanError = {
                        status: customerError.response?.status,
                        message: errorDetail || customerError.message,
                        email: email
                    };
                    console.error('Failed to create Lemon Squeezy customer (non-critical):', cleanError);
                }
            }
        }

    } catch (error) {
        console.error('500 Internal Server Error:', {
            message: error.message,
            stack: error.stack,
            email: req.body.email
        });
        res.status(500).json({
            success: false,
            status: 500,
            message: 'Error verifying email',
            details: error.message
        });
    }
});

module.exports = router; 