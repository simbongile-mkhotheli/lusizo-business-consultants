require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");
const rateLimit = require("express-rate-limit");
const { body, validationResult } = require("express-validator");
const winston = require("winston");
const crypto = require("crypto");

const app = express();

// Logger setup
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "error.log", level: "error" })
  ]
});

// PostgreSQL Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for Render PostgreSQL
  }
});

pool.connect((err, client, release) => {
  if (err) {
    logger.error("❌ PostgreSQL Connection Error:", { error: err.message });
    process.exit(1);
  } else {
    logger.info("✅ Connected to PostgreSQL on Render!");
    release();
  }
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1d" }));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests, please try again later."
});
app.use(limiter);

// Set View Engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Home Route
app.get("/", (req, res) => {
  const nonce = crypto.randomBytes(16).toString("base64");
  res.render("index", { nonce });
});

// PayPal Config Route
app.get("/config/paypal", (req, res) => {
  if (!process.env.PAYPAL_CLIENT_ID) {
    logger.error("❌ PayPal Client ID missing");
    return res.status(500).json({ error: "PayPal Client ID not found" });
  }
  res.json({ clientId: process.env.PAYPAL_CLIENT_ID });
});
app.get("/api/services", (req, res) => {
  res.json([
    { id: 1, name: "Basic Service", price: 100 },
    { id: 2, name: "Premium Service", price: 200 },
    { id: 3, name: "Enterprise Service", price: 300 }
  ]);
});

// API route to return service details securely
const router = express.Router();


// Simulated services database
const services = [
  { id: 1, name: "Basic Service", price: 100 },
  { id: 2, name: "Premium Service", price: 200 },
  { id: 3, name: "Enterprise Service", price: 300 }
];

// Validate service route
router.post("/api/validate-service", (req, res) => {
  const { name } = req.body;

  // Find the service by name
  const service = services.find(s => s.name === name);

  if (!service) {
    return res.status(400).json({ error: "Invalid service selection" });
  }

  res.json({ name: service.name, price: service.price });
});

app.use(router);

// Save Transaction Route
app.post(
  "/save-transaction",
  [
    body("transaction_id").notEmpty().withMessage("Transaction ID is required."),
    body("payer_name").notEmpty().withMessage("Payer name is required."),
    body("payer_email").isEmail().withMessage("A valid email is required."),
    body("amount").isNumeric().withMessage("Amount must be numeric."),
    body("currency").optional().isLength({ min: 3, max: 3 }),
    body("payment_status").optional().trim(),
    body("service_type").optional().trim()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn("⚠️ Validation error", { errors: errors.array() });
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    try {
      const { transaction_id, payer_name, payer_email, amount, currency, payment_status, service_type } = req.body;

      const query = `INSERT INTO transactions (transaction_id, payer_name, payer_email, amount, currency, payment_status, service_type)
                     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`;

      const result = await pool.query(query, [transaction_id, payer_name, payer_email, amount, currency, payment_status, service_type]);

      logger.info("✅ Transaction saved", { transaction_id, payer_email, amount });
      res.json({ success: true, message: "Transaction saved", transaction: result.rows[0] });
    } catch (error) {
      logger.error("❌ Database error", { error: error.message });
      res.status(500).json({ success: false, error: "Database error" });
    }
  }
);

// Global Error Handler
app.use((err, req, res, next) => {
  logger.error("❌ Unhandled Error", { error: err.message });
  res.status(500).json({ success: false, error: "An unexpected error occurred." });
});

app.use(router);

// Start Server
const port = process.env.PORT || 5000;
app.listen(port, "0.0.0.0", () => logger.info(`✅ Server running on port ${port}`));
