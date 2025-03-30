require("dotenv").config();
const express = require("express");
const mysql = require("mysql");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");
const rateLimit = require("express-rate-limit");
const { body, validationResult } = require("express-validator");
const winston = require("winston");
const crypto = require("crypto");

// Logger setup with Winston
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

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const app = express();

// Set EJS as the view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests from this IP, please try again after 15 minutes."
});
app.use(limiter);

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1d" }));

app.get("/", (req, res) => {
  // Generate a dynamic nonce for every request (16 random bytes, base64 encoded)
  const nonce = crypto.randomBytes(16).toString("base64");
  res.render("index", { nonce });
});

app.get("/config/paypal", asyncHandler(async (req, res) => {
  if (!process.env.PAYPAL_CLIENT_ID) {
    logger.error("PayPal Client ID not found");
    return res.status(500).json({ error: "PayPal Client ID not found" });
  }
  res.json({ clientId: process.env.PAYPAL_CLIENT_ID });
}));


// ... (Rest of your MySQL and /save-transaction code remains unchanged)

const pool = mysql.createPool({
  connectionLimit: 10,
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

const query = (sql, values) => {
  return new Promise((resolve, reject) => {
    pool.query(sql, values, (err, result) => {
      if (err) {
        logger.error("MySQL Query Error", { error: err.message });
        return reject(err);
      }
      resolve(result);
    });
  });
};

pool.getConnection((err, connection) => {
  if (err) {
    logger.error("MySQL connection pool error", { error: err.message });
    process.exit(1);
  }
  logger.info("✅ MySQL Connection Pool Established");
  connection.release();
});

app.post(
  "/save-transaction",
  [
    body("transaction_id").notEmpty().withMessage("Transaction ID is required.").trim().escape(),
    body("payer_name").notEmpty().withMessage("Payer name is required.").trim().escape(),
    body("payer_email").isEmail().withMessage("A valid email is required.").normalizeEmail(),
    body("amount").isNumeric().withMessage("Amount must be a numeric value."),
    body("currency").optional().isLength({ min: 3, max: 3 }).withMessage("Currency code must be 3 letters.").trim().escape(),
    body("payment_status").optional().trim().escape(),
    body("service_type").optional().trim().escape()
  ],
  asyncHandler(async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn("Validation error", { errors: errors.array() });
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    try {
      const { transaction_id, payer_name, payer_email, amount, currency, payment_status, service_type } = req.body;
      const sql = `INSERT INTO transactions (transaction_id, payer_name, payer_email, amount, currency, payment_status, service_type) VALUES (?, ?, ?, ?, ?, ?, ?)`;
      await query(sql, [transaction_id, payer_name, payer_email, amount, currency, payment_status, service_type]);
      logger.info("Transaction saved", { transaction_id, payer_email, amount });
      res.json({ success: true, message: "Transaction saved" });
    } catch (error) {
      next(error);
    }
  })
);




app.use((err, req, res, next) => {
  logger.error("Unhandled error", { error: err.message, stack: err.stack });
  res.status(500).json({ success: false, error: "An unexpected error occurred." });
});

const port = process.env.PORT || 5000;
app.listen(port, () => logger.info(`✅ Server running on http://localhost:${port}`));
