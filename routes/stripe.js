const express = require("express");
const router = express.Router();
const stripe = require("stripe");
const User = require("../models/User");
const crypto = require("crypto");
const endpointSecret = "whsec_KAe4b4qpkGsQYmnTJnP4GJpKJgA0Fh6s";

const stripeClient = stripe(process.env.STRIPE_SECRET_KEY);

router.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripeClient.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error("Webhook Error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const subscription = event.data.object;
  const customerId = subscription.customer;

  try {
    const customer = await stripeClient.customers.retrieve(customerId);
    const email = customer.email.toLowerCase();

    let user = await User.findOne({ email });

    if (!user) {
      console.log(`No user found for email: ${email}`);
      return res.json({ received: true });
    }

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated"
    ) {
      const subscriptionId = subscription.id;
      const status = subscription.status;

      // Update license keys
      user.keys.forEach((key) => {
        if (key.stripeCustomerId === customerId && !key.stripeSubscriptionId) {
          key.stripeSubscriptionId = subscriptionId;
          key.licenseStatus = status;
        }
      });

      await user.save();
    } else if (event.type === "customer.subscription.deleted") {
      const subscriptionId = subscription.id;

      // Remove license keys related to this subscription
      user.keys = user.keys.filter(
        (key) => key.stripeSubscriptionId !== subscriptionId
      );
      await user.save();
    } else {
      console.log("Unhandled event type:", event.type);
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Webhook handling error:", err);
    res.status(500).send("Webhook processing failed");
  }
});

module.exports = router;
