const express = require('express');
const router = express.Router();
const stripe = require('stripe');
const User = require('../models/User');
const endpointSecret = 'whsec_KAe4b4qpkGsQYmnTJnP4GJpKJgA0Fh6s';

const stripeClient = stripe(process.env.STRIPE_SECRET_KEY);

router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripeClient.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('⚠️ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Send response to Stripe immediately
  res.status(200).json({ received: true });

  // Continue processing in the background
  process.nextTick(async () => {
    const subscription = event.data.object;
    const customerId = subscription.customer;

    try {
      const customer = await stripeClient.customers.retrieve(customerId);
      const email = customer.email?.toLowerCase();

      if (!email) {
        console.warn('Customer email not found');
        return;
      }

      const user = await User.findOne({ email });

      if (!user) {
        console.warn(`No user found for email: ${email}`);
        return;
      }

      const subscriptionId = subscription.id;
      const status = subscription.status;

      if (
        event.type === 'customer.subscription.created' ||
        event.type === 'customer.subscription.updated'
      ) {
        user.keys.forEach((key) => {
          if (key.stripeCustomerId === customerId) {
            key.stripeSubscriptionId =
              key.stripeSubscriptionId || subscriptionId;
            key.licenseStatus = status;
          }
        });
        await user.save();
      } else if (event.type === 'customer.subscription.deleted') {
        user.keys.forEach((key) => {
          if (key.stripeSubscriptionId === subscriptionId) {
            key.licenseStatus = 'canceled';
          }
        });
        await user.save();
      } else {
        console.log('Unhandled event type:', event.type);
      }
    } catch (err) {
      console.error('Error processing webhook in background:', err);
    }
  });
});

module.exports = router;
