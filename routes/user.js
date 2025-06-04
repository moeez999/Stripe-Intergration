const express = require("express");
const router = express.Router();
const User = require("../models/User");
const axios = require("axios");
const crypto = require("crypto");
const Stripe = require("stripe");
const { url } = require("inspector");
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
// Add this function at the top of the file after the imports
async function resetFreeUserUsage() {
  try {
    // Find all users with free keys
    const users = await User.find({ "keys.variant_id": "free" });
    const oneMinuteAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    let resetCount = 0;

    for (const user of users) {
      // Check each free key in the user's keys array
      user.keys.forEach((key) => {
        if (key.variant_id === "free" && key.lastReset < oneMinuteAgo) {
          key.usage = 0;
          key.lastReset = new Date();
          resetCount++;
        }
      });

      // Only save if we made changes to this user's keys
      if (user.isModified()) {
        await user.save();
      }
    }

    console.log(`Reset usage for ${resetCount} free keys`);
  } catch (error) {
    console.error("Error resetting free user usage:", error);
  }
}

// Set up the interval to run every 24 hours
setInterval(resetFreeUserUsage, 24 * 60 * 60 * 1000);

// Run it once when the server starts
resetFreeUserUsage();

// router.post('/register', async (req, res) => {
//     try {
//         const { licenseKey, deviceId, email } = req.body;

//         console.log('Received registration request:', { licenseKey, email, deviceId });

//         // Check key format
//         const isLemonSqueezyFormat = /^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$/i.test(licenseKey);
//         const isFreeKeyFormat = /^[A-F0-9]{8}-[A-F0-9]{8}-[A-F0-9]{8}-[A-F0-9]{8}-[A-F0-9]{8}$/i.test(licenseKey);

//         if (!isLemonSqueezyFormat && !isFreeKeyFormat) {
//             return res.status(400).json({
//                 valid: false,
//                 message: 'Invalid license key format'
//             });
//         }

//         // Handle free key registration
//         if (isFreeKeyFormat) {
//             console.log('Processing free key registration');

//             // Find user by email
//             const user = await User.findOne({ email: email.toLowerCase() });

//             if (!user) {
//                 return res.status(400).json({
//                     error: 'No user found with this email',
//                     registeredDevices: 0,
//                     maxDevices: 1,
//                     isDeviceRegistered: false
//                 });
//             }

//             // Find the free key in user's keys
//             const freeKey = user.keys.find(k => k.key === licenseKey && k.variant_id === 'free');

//             if (!freeKey) {
//                 return res.status(400).json({
//                     error: 'Free license key not found for this user',
//                     registeredDevices: 0,
//                     maxDevices: 1,
//                     isDeviceRegistered: false
//                 });
//             }

//             // Check if device is already registered
//             if (freeKey.registeredDevice) {
//                 if (freeKey.registeredDevice === deviceId) {
//                     return res.json({
//                         message: 'Device already registered',
//                         registeredDevice: deviceId,
//                         maxDevices: 1,
//                         isDeviceRegistered: true,
//                         plan: 'free'
//                     });
//                 } else {
//                     return res.status(400).json({
//                         error: 'This free license key is already registered to another device',
//                         registeredDevice: freeKey.registeredDevice,
//                         maxDevices: 1,
//                         isDeviceRegistered: false
//                     });
//                 }
//             }

//             // Register the new device
//             freeKey.registeredDevice = deviceId;
//             await user.save();

//             return res.status(201).json({
//                 message: 'Device registered successfully',
//                 registeredDevice: deviceId,
//                 maxDevices: 1,
//                 isDeviceRegistered: true,
//                 plan: 'free'
//             });
//         }

//         // Handle Lemon Squeezy key registration
//         console.log('Processing Lemon Squeezy key registration');

//         // Step 1: Validate with Lemon Squeezy
//         let lemonSqueezyResponse;

//         // Validate with Lemon Squeezy
//         try {
//             lemonSqueezyResponse = await axios.post(
//                 'https://api.lemonsqueezy.com/v1/licenses/validate',
//                 { license_key: licenseKey },
//                 {
//                     headers: {
//                         'Authorization': `Bearer ${process.env.LEMON_SQUEEZY_API_KEY}`,
//                         'Content-Type': 'application/json'
//                     }
//                 }
//             );
//         } catch (error) {
//             console.error('Lemon Squeezy validation error:', error);
//             return res.status(400).json({
//                 valid: false,
//                 message: 'License key invalid'
//             });
//         }

//         // Check if license is valid but inactive
//         if (lemonSqueezyResponse.data.valid &&
//             lemonSqueezyResponse.data.license_key.status === 'inactive') {

//             console.log('License is valid but inactive. Activating...');

//             // Activate the license key
//             await axios.post(
//                 'https://api.lemonsqueezy.com/v1/licenses/activate',
//                 {
//                     license_key: licenseKey,
//                     instance_name: deviceId
//                 },
//                 {
//                     headers: {
//                         'Authorization': `Bearer ${process.env.LEMON_SQUEEZY_API_KEY}`,
//                         'Content-Type': 'application/json'
//                     }
//                 }
//             );

//             console.log('License activated successfully');
//         }

//         // Check if license is valid
//         if (!lemonSqueezyResponse.data.valid) {
//             return res.status(400).json({
//                 error: 'Invalid license key',
//                 registeredDevices: 0,
//                 maxDevices: parseInt(process.env.MAX_DEVICES) || 2,
//                 isDeviceRegistered: false
//             });
//         }

//         // Check if email matches
//         const licenseEmail = lemonSqueezyResponse.data.meta?.customer_email;
//         if (!licenseEmail || licenseEmail.toLowerCase() !== email.toLowerCase()) {
//             return res.status(400).json({
//                 error: 'The email address does not match the license key',
//                 registeredDevices: 0,
//                 maxDevices: parseInt(process.env.MAX_DEVICES) || 2,
//                 isDeviceRegistered: false
//             });
//         }

//         const variantId = lemonSqueezyResponse.data.meta.variant_id;

//         // Find or create user
//         let user = await User.findOne({ email: email.toLowerCase() });
//         console.log('User lookup result:', user ? 'User found' : 'No user found');

//         if (!user) {
//             console.log('Creating new user for email:', email.toLowerCase());
//             const nameParts = lemonSqueezyResponse.data.meta.customer_name ?
//                 lemonSqueezyResponse.data.meta.customer_name.split(' ') : [];
//             const firstName = nameParts[0] || '';
//             const lastName = nameParts.slice(1).join(' ') || '';
//             user = new User({
//                 email: email.toLowerCase(),
//                 firstName: firstName,
//                 lastName: lastName,
//                 source: null,
//                 keys: []
//             });
//         }

//         // Find the key in the user's keys array
//         let keyEntry = user.keys.find(k => k.key === licenseKey);
//         console.log('Key lookup result:', keyEntry ? 'Key found' : 'No key found');

//         if (!keyEntry) {
//             console.log('Creating new key entry for license key:', licenseKey);
//             // Add new key if it doesn't exist
//             keyEntry = {
//                 key: licenseKey,
//                 variant_id: variantId,
//                 registeredDevice: deviceId,
//                 usage: 0
//             };
//             user.keys.push(keyEntry);
//             await user.save();
//             console.log('New key entry created and saved successfully');

//             return res.status(201).json({
//                 message: 'Device registered successfully',
//                 registeredDevice: keyEntry.registeredDevice,
//                 maxDevices: 1,
//                 isDeviceRegistered: true,
//                 plan: 'pro'
//             });
//         }

//         // Key exists, check device registration
//         console.log('Checking device registration status:', {
//             currentDevice: deviceId,
//             registeredDevice: keyEntry.registeredDevice
//         });

//         if (keyEntry.registeredDevice === deviceId) {
//             console.log('Device already registered to this key');
//             // Device is already registered to this key
//             return res.json({
//                 message: 'Device already registered',
//                 registeredDevice: keyEntry.registeredDevice,
//                 maxDevices: 1,
//                 isDeviceRegistered: true,
//                 plan: 'pro'
//             });
//         }

//         if (keyEntry.registeredDevice !== null) {
//             console.log('Key is registered to a different device:', keyEntry.registeredDevice);
//             // Key exists but is registered to a different device
//             return res.status(400).json({
//                 error: 'This license key is already registered to another device. Please contact support@cutpilot.io to remove the device from your account.',
//                 registeredDevice: keyEntry.registeredDevice,
//                 maxDevices: 1,
//                 isDeviceRegistered: false
//             });
//         }

//         console.log('Registering new device to existing key');
//         // Key exists but no device is registered, register the new device
//         keyEntry.registeredDevice = deviceId;
//         await user.save();
//         console.log('Device registration completed successfully');

//         return res.status(201).json({
//             message: 'Device registered successfully',
//             registeredDevice: keyEntry.registeredDevice,
//             maxDevices: 1,
//             isDeviceRegistered: true,
//             plan: 'pro'
//         });

//     } catch (error) {
//         console.error('Registration error:', error);
//         res.status(500).json({
//             error: 'Error registering device',
//             details: error.message
//         });
//     }
// });

// ...existing code...

// Helper to generate a free trial key
function generateFreeTrialKey() {
  // Format: XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX (hex)
  return Array(5)
    .fill(0)
    .map(() => crypto.randomBytes(4).toString("hex").toUpperCase())
    .join("-");
}

router.post("/register", async (req, res) => {
  try {
    const { email, product_id, firstName, lastName } = req.body;

    // Validate required fields
    if (!email || !product_id || !firstName || !lastName) {
      return res.status(400).json({
        error: "firstName, lastName, email and product_id are required",
      });
    }

    // 1. Get prices for the product
    const prices = await stripe.prices.list({
      product: product_id,
      active: true,
    });

    if (!prices.data.length) {
      return res.status(400).json({
        error: "No active price found for this product_id",
      });
    }

    const priceId = prices.data[0].id;

    // 2. Create Stripe customer
    const customer = await stripe.customers.create({ email });

    // 3. Create Stripe subscription
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      payment_behavior: "default_incomplete",
    });

    // 4. Generate license key
    const licenseKey = generateFreeTrialKey();
    const keyObj = {
      key: licenseKey,
      product_id,
      // registeredDevice: deviceId,
      lastReset: new Date(),
      aiUsage: 0,
      licenseStatus: "trialing",
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: customer.id,
    };

    // 5. Save or update user
    let user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      user = new User({
        email: email.toLowerCase(),
        firstName,
        lastName,
        // deviceId,
        keys: [keyObj],
      });
    } else {
      user.keys.push(keyObj);

      // Optionally update user's name/deviceId if not already stored
      user.firstName = user.firstName || firstName;
      user.lastName = user.lastName || lastName;
    }

    await user.save();

    res.status(201).json({
      message: "Free trial registered and Stripe subscription created",
      licenseKey,
      stripeCustomerId: customer.id,
      stripeSubscriptionId: subscription.id,
    });
  } catch (error) {
    console.error("Free trial registration error:", error);
    res.status(500).json({
      error: "Error registering free trial",
      details: error.message,
    });
  }
});

// ...existing code...
router.post("/track-usage", async (req, res) => {
  try {
    const { licenseKey, silences, speakerchanges } = req.body;

    // Validate inputs
    if (
      !licenseKey ||
      typeof silences !== "number" ||
      typeof speakerchanges !== "number"
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid input parameters",
      });
    }

    // Find user with this license key
    const user = await User.findOne({ "keys.key": licenseKey });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "License key not found",
      });
    }

    // Find the specific key in the user's keys array
    const keyEntry = user.keys.find((k) => k.key === licenseKey);

    // Calculate weighted usage
    const weightedSilences = silences * process.env.SILENCE_WEIGHT; // Each silence removal costs 1
    const weightedSpeakerChanges = Math.round(
      speakerchanges * process.env.SPEAKER_CHANGE_WEIGHT
    ); // Each speaker change costs 0.5
    const newUsage = keyEntry.usage + weightedSilences + weightedSpeakerChanges;
    const usageLimit = parseInt(process.env.USAGE_LIMIT);

    // Check if the key is for a pro plan
    if (keyEntry.variant_id !== "free") {
      // For pro users, track usage but don't enforce limits
      keyEntry.usage = newUsage;
      await user.save();

      return res.json({
        success: true,
        message: "Pro plan - no usage limits",
        currentUsage: newUsage,
        limit: null,
        isPro: true,
      });
    }

    // For free plans, check usage limit
    if (newUsage >= usageLimit) {
      return res.json({
        success: false,
        message: "Usage limit reached",
        currentUsage: keyEntry.usage,
        newUsage: newUsage, // Include the potential new usage
        limit: usageLimit,
        isPro: false,
      });
    }

    // Only update usage if under the limit
    keyEntry.usage = newUsage;
    await user.save();

    return res.json({
      success: true,
      message: "Usage updated successfully",
      currentUsage: newUsage,
      limit: usageLimit,
      isPro: false,
    });
  } catch (error) {
    console.error("Usage tracking error:", error);
    res.status(500).json({
      success: false,
      message: "Error tracking usage",
      error: error.message,
    });
  }
});

router.post("/analyze-podcast", async (req, res) => {
  try {
    const { audioData, thresholdDb, minDuration, credentials } = req.body;

    // First find the user and validate their license
    const user = await User.findOne({ "keys.key": credentials.licenseKey });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "License key not found",
      });
    }

    // Find the specific key in the user's keys array
    const keyEntry = user.keys.find((k) => k.key === credentials.licenseKey);

    // Perform the audio analysis
    const amplitudeToDb = (amplitude) => {
      const float32 = amplitude / 32767;
      return 20 * Math.log10(Math.max(Math.abs(float32), 1e-8));
    };

    let lastSpeakerIndex = null;
    let lastSpeakerTime = 0;
    const speakerChanges = [];

    // Analyze in chunks
    const chunkSize = 100;
    const totalChunks = Math.ceil(audioData[0].amplitudes.length / chunkSize);

    for (let chunk = 0; chunk < totalChunks; chunk++) {
      const startSample = chunk * chunkSize;
      const endSample = Math.min(
        (chunk + 1) * chunkSize,
        audioData[0].amplitudes.length
      );

      for (let i = startSample; i < endSample; i++) {
        const currentTime = i / audioData[0].sampleRate;
        if (currentTime - lastSpeakerTime < minDuration) continue;

        let maxDb = -100;
        let loudestSpeakerIndex = -1;

        audioData.forEach((audio, index) => {
          const amplitude = Math.abs(audio.amplitudes[i] || 0);
          const db = amplitudeToDb(amplitude);
          if (db > maxDb && db > thresholdDb) {
            maxDb = db;
            loudestSpeakerIndex = index;
          }
        });

        if (
          loudestSpeakerIndex !== -1 &&
          loudestSpeakerIndex !== lastSpeakerIndex
        ) {
          if (lastSpeakerIndex !== null) {
            speakerChanges.push({
              trackNumber: parseInt(
                audioData[lastSpeakerIndex].info.videoTrack.replace("V", "")
              ),
              inPoint: lastSpeakerTime,
              outPoint: currentTime,
              nextTrack: parseInt(
                audioData[loudestSpeakerIndex].info.videoTrack.replace("V", "")
              ),
              nextTrackInPoint: currentTime,
            });
          }
          lastSpeakerIndex = loudestSpeakerIndex;
          lastSpeakerTime = currentTime;
        }
      }
    }

    // Now check usage limits before returning the results
    const speakerChangesCount = speakerChanges.length;
    console.log("Speaker changes count:", speakerChangesCount);
    const weightedSpeakerChanges = Math.round(
      speakerChangesCount * process.env.SPEAKER_CHANGE_WEIGHT
    );
    const newUsage = keyEntry.usage + weightedSpeakerChanges;
    const usageLimit = parseInt(process.env.USAGE_LIMIT);

    // For pro users, just track usage without limits
    if (keyEntry.variant_id !== "free") {
      keyEntry.usage = newUsage;
      await user.save();

      return res.json({
        success: true,
        speakerChanges,
        usage: {
          success: true,
          message: "Pro plan - no usage limits",
          currentUsage: newUsage,
          limit: null,
          isPro: true,
        },
      });
    }

    // For free plans, check usage limit
    if (newUsage >= usageLimit) {
      return res.json({
        success: false,
        error: "Usage limit reached",
        usage: {
          success: false,
          message: "Usage limit reached",
          currentUsage: keyEntry.usage,
          newUsage: newUsage,
          limit: usageLimit,
          isPro: false,
        },
      });
    }

    // Update usage for free plan users
    keyEntry.usage = newUsage;
    await user.save();

    return res.json({
      success: true,
      speakerChanges,
      usage: {
        success: true,
        message: "Usage updated successfully",
        currentUsage: newUsage,
        limit: usageLimit,
        isPro: false,
      },
    });
  } catch (error) {
    console.error("Error analyzing podcast audio:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

function generateUniqueLicenseKey() {
  return Array(5)
    .fill(0)
    .map(() => crypto.randomBytes(4).toString("hex").toUpperCase())
    .join("-");
}

router.post("/create-paid-checkout-session", async (req, res) => {
  try {
    const { email, product_id, quantity = 1 } = req.body;

    if (!email || !product_id) {
      return res.status(400).json({
        error: "email and product_id are required",
      });
    }

    const prices = await stripe.prices.list({
      product: product_id,
      active: true,
    });

    if (!prices.data.length) {
      return res.status(400).json({
        error: "No active price found for this product_id",
      });
    }

    const priceId = prices.data[0].id;

    const customer = await stripe.customers.create({
      email,
      metadata: {
        source: "paid_form",
      },
    });

    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity,
        },
      ],
      mode: "subscription",
      success_url: `http://127.0.0.1:5500/test/paymentSuccess.html?stripeCustomerId=${customer.id}&product_id=${product_id}&quantity=${quantity}`,
      cancel_url: "https://clinquant-naiad-5a8fed.netlify.app/test.html",
      metadata: {
        email,
        product_id,
        quantity,
      },
    });

    // Generate license keys
    const licenseKeys = [];
    for (let i = 0; i < quantity; i++) {
      licenseKeys.push(generateUniqueLicenseKey());
    }

    // Save or update user in database
    let user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      user = new User({ email: email.toLowerCase(), keys: [] });
    }

    licenseKeys.forEach((key) => {
      user.keys.push({
        key,
        variant_id: "pro",
        product_id,
        licenseStatus: "incomplete", // Will be updated by webhook later
        stripeCustomerId: customer.id,
        stripeSubscriptionId: null, // Will be updated via webhook
      });
    });

    await user.save();

    return res.status(201).json({
      message: "Checkout session created successfully",
      url: session.url,
      licenseKeys,
      plan: "pro",
    });
  } catch (error) {
    console.error("Checkout session error:", error);
    return res.status(500).json({
      error: "Error creating checkout session",
      details: error.message,
    });
  }
});

router.get("/user-get/:customerId", async (req, res) => {
  try {
    const { customerId } = req.params;

    if (!customerId) {
      return res.status(400).json({ error: "Customer ID is required" });
    }

    // Retrieve the Stripe customer to validate the ID (optional, but good practice)
    const stripeCustomer = await stripe.customers.retrieve(customerId);
    if (!stripeCustomer || stripeCustomer.deleted) {
      return res.status(404).json({ error: "Stripe customer not found" });
    }

    // Find the user in your database
    const user = await User.findOne({
      "keys.stripeCustomerId": customerId,
    });

    if (!user) {
      return res
        .status(404)
        .json({ error: "User not found for this customer ID" });
    }

    return res.status(200).json({
      message: "User found",
      user,
    });
  } catch (error) {
    console.error("Error fetching user by Stripe customer ID:", error);
    return res.status(500).json({
      error: "Server error fetching user",
      details: error.message,
    });
  }
});
module.exports = router;
