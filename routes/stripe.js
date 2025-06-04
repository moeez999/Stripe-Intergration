const express = require("express");
const router = express.Router();
const stripe = require("stripe");
const User = require("../models/User");
const crypto = require("crypto");
const endpointSecret = "whsec_KAe4b4qpkGsQYmnTJnP4GJpKJgA0Fh6s";

router.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  // Initialize Stripe with the secret key from environment variables
  const stripeClient = stripe(process.env.STRIPE_SECRET_KEY);

  try {
    event = stripeClient.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error("Webhook Error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // if (event.type === 'customer.subscription.created') {
  //   console.log('Received Stripe webhook:', event.data.object);
  //   const subscription = event.data.object;
  //   try {
  //     const customer = await stripeClient.customers.retrieve(subscription.customer);
  //     const email = customer.email;
  //     console.log('Customer email:', email);
  //   } catch (error) {
  //     console.error('Error retrieving customer:', error);
  //     return res.status(500).json({ error: 'Failed to process subscription' });
  //   }
  // }

  if (event.type === "customer.subscription.created") {
    const subscription = event.data.object;
    const customer = await stripeClient.customers.retrieve(
      subscription.customer
    );
    const email = customer.email;

    // Generate license key and assign to user
    let user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      user = new User({ email: email.toLowerCase(), keys: [] });
    }
    const licenseKey = await generateUniqueLicenseKey();
    user.keys.push({
      key: licenseKey,
      variant_id: "pro",
      product_id: subscription.items.data[0].price.product,
      licenseStatus: subscription.status,
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: subscription.customer,
    });
    await user.save();

    // // Email license key to user
    // await transporter.sendMail({
    //   to: email,
    //   subject: "Your CutPilot Pro License Key",
    //   text: `Thank you for your purchase!\n\nYour Pro license key: ${licenseKey}`,
    // });
  } else if (event.type === "customer.subscription.updated") {
    const subscription = event.data.object;
    const customer = await stripeClient.customers.retrieve(
      subscription.customer
    );
    const email = customer.email;

    // Update license key and assign to user
    let user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      user = new User({ email: email.toLowerCase(), keys: [] });
    }
    const licenseKey = await generateUniqueLicenseKey();
    user.keys.push({
      key: licenseKey,
      variant_id: "pro",
      product_id: subscription.items.data[0].price.product,
      licenseStatus: subscription.status,
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: subscription.customer,
    });
    await user.save();

    // // Email license key to user
    // await transporter.sendMail({
    //   to: email,
    //   subject: "Your CutPilot Pro License Key",
    //   text: `Thank you for your purchase!\n\nYour Pro license key: ${licenseKey}`,
    // });
  } else if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object;
    const customer = await stripeClient.customers.retrieve(
      subscription.customer
    );
    const email = customer.email;

    // Update license key and assign to user
    let user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      user = new User({ email: email.toLowerCase(), keys: [] });
    }
    user.keys.forEach((key, index) => {
      if (key.stripeSubscriptionId === subscription.id) {
        user.keys.splice(index, 1);
      }
    });
    await user.save();
  } else {
    console.log("Unhandled Stripe event:", event.type);
  }

  res.json({ received: true });
});

function generateUniqueLicenseKey() {
  // Format: XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX (hex)
  return Array(5)
    .fill(0)
    .map(() => crypto.randomBytes(4).toString("hex").toUpperCase())
    .join("-");
}
module.exports = router;
