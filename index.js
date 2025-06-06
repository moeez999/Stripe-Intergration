const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");

// Suppress punycode warning
process.removeAllListeners("warning");

const licenseRoutes = require("./routes/license");
const userRoutes = require("./routes/user");
const webflowRoutes = require("./routes/webflow");
const analyzeTranscriptionRoutes = require("./routes/analyze-transcription");
const stripeRoutes = require("./routes/stripe");
const mogrtcheckRoutes = require("./routes/mogrtcheck");

dotenv.config();

const app = express();

// Middleware
// Middleware
const corsOptions = {
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false,
};

app.use(cors(corsOptions));
// Special handling for Stripe webhooks - must be before other body parsers
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));

// Regular body parsers for other routes
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI, {
    dbName: "cutpilot", // Explicitly set database name
  })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Routes
app.use("/api/license", licenseRoutes);
app.use("/api/user", userRoutes);
app.use("/api/webflow", webflowRoutes);
app.use("/api/analyze-transcription", analyzeTranscriptionRoutes);
app.use("/api/stripe", stripeRoutes);
app.use("/api/mogrtcheck", mogrtcheckRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
