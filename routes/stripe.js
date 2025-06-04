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

  // Handle subscription creation
  if (event.type === "customer.subscription.created") {
    const subscription = event.data.object;

    // Retrieve customer to get metadata
    const customer = await stripeClient.customers.retrieve(
      subscription.customer
    );
    const email = customer.email;

    // Retrieve checkout session to get metadata
    const sessions = await stripeClient.checkout.sessions.list({
      customer: subscription.customer,
      limit: 1,
    });

    const session = sessions.data[0];
    const quantity = parseInt(session.metadata?.quantity || "1");
    const product_id =
      session.metadata?.product_id || subscription.items.data[0].price.product;

    let user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      user = new User({ email: email.toLowerCase(), keys: [] });
    }

    // Generate multiple license keys
    for (let i = 0; i < quantity; i++) {
      const licenseKey = generateUniqueLicenseKey();
      user.keys.push({
        key: licenseKey,
        variant_id: "pro",
        product_id,
        licenseStatus: subscription.status,
        stripeSubscriptionId: subscription.id,
        stripeCustomerId: subscription.customer,
      });
    }

    await user.save();
  }

  // Other event types can stay unchanged
  else if (event.type === "customer.subscription.updated") {
    const subscription = event.data.object;
    const customer = await stripeClient.customers.retrieve(
      subscription.customer
    );
    const email = customer.email;

    let user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      user = new User({ email: email.toLowerCase(), keys: [] });
    }

    const licenseKey = generateUniqueLicenseKey();
    user.keys.push({
      key: licenseKey,
      variant_id: "pro",
      product_id: subscription.items.data[0].price.product,
      licenseStatus: subscription.status,
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: subscription.customer,
    });
    await user.save();
  } else if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object;
    const customer = await stripeClient.customers.retrieve(
      subscription.customer
    );
    const email = customer.email;

    let user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(200).json({ received: true }); // No user, nothing to remove
    }

    user.keys = user.keys.filter(
      (key) => key.stripeSubscriptionId !== subscription.id
    );
    await user.save();
  } else {
    console.log("Unhandled Stripe event:", event.type);
  }

  res.json({ received: true });
});

function generateUniqueLicenseKey() {
  return Array(5)
    .fill(0)
    .map(() => crypto.randomBytes(4).toString("hex").toUpperCase())
    .join("-");
}

module.exports = router;
