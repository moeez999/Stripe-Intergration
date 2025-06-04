const mongoose = require("mongoose");

const keySchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
  },
  product_id: {
    type: String,
    required: true,
  },
  registeredDevice: {
    type: String,
    default: null,
  },
  lastReset: {
    type: Date,
    default: Date.now,
  },
  aiUsage: {
    type: Number,
    default: 0, // Track AI tokens/minutes/whatever you define
  },
  licenseStatus: {
    type: String,
    enum: [
      "active",
      "past_due",
      "canceled",
      "incomplete",
      "incomplete_expired",
      "trialing",
      "unpaid",
    ], // Add all relevant Stripe statuses
    default: "trialing", // Match Stripe subscription status
  },
  stripeSubscriptionId: {
    type: String,
    default: null,
  },
  stripeCustomerId: {
    type: String,
    default: null,
  },
});

const onboardingSchema = new mongoose.Schema({
  data: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: new Map(),
  },
  submittedAt: {
    type: Date,
    default: Date.now,
  },
});

const usageLogSchema = new mongoose.Schema({
  timestamp: {
    type: Date,
    default: Date.now,
  },
  feature: {
    type: String,
    enum: ["silence", "podcast", "animated-subtitles"],
  },
});

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    index: true,
    lowercase: true,
  },
  firstName: {
    type: String,
    default: "",
  },
  lastName: {
    type: String,
    default: "",
  },
  source: {
    type: String,
    default: null,
  },
  keys: [keySchema],
  onboarding: {
    type: onboardingSchema,
    default: () => ({}),
  },
  usageLogs: [usageLogSchema],
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("User", userSchema);
