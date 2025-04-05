// ───────────────────────────────────────────────────────────────────────────────
// 0. Environment Variables (require .env.example to exist with all keys)
// ───────────────────────────────────────────────────────────────────────────────
require("dotenv-safe").config();

const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");
const rateLimit = require("express-rate-limit");
const { body, validationResult } = require("express-validator");
const winston = require("winston");
const expressWinston = require("express-winston");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const csurf = require("csurf");
const nodemailer = require("nodemailer");
const app = express();

// ───────────────────────────────────────────────────────────────────────────────
// 1. Winston Logger Setup
// ───────────────────────────────────────────────────────────────────────────────
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp({
      format: () =>
        new Date().toLocaleString("en-US", { timeZone: "Africa/Johannesburg" }),
    }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "error.log", level: "error" }),
  ],
});

// ───────────────────────────────────────────────────────────────────────────────
// 2. PostgreSQL Connection
// ───────────────────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
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

// ───────────────────────────────────────────────────────────────────────────────
// 3. Nodemailer Transporter
// ───────────────────────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: "Gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ───────────────────────────────────────────────────────────────────────────────
// 4. ApiError Class & Async Wrapper
// ───────────────────────────────────────────────────────────────────────────────
class ApiError extends Error {
  constructor(statusCode, code, message, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ───────────────────────────────────────────────────────────────────────────────
// 5. Middleware Setup
// ───────────────────────────────────────────────────────────────────────────────
// 5.1 Assign a unique requestId
app.use((req, res, next) => {
  req.requestId = uuidv4();
  res.setHeader("X-Request-Id", req.requestId);
  next();
});

// 5.2 Express-Winston HTTP request logging
app.use(
  expressWinston.logger({
    winstonInstance: logger,
    meta: true,
    msg: "{{req.method}} {{req.url}} {{res.statusCode}} {{res.responseTime}}ms",
    expressFormat: false,
    colorize: false,
    dynamicMeta: (req, res) => ({
      requestId: req.requestId,
      userAgent: req.get("User-Agent"),
    }),
  })
);

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1d" }));
app.use(cookieParser());

// 5.3 Rate Limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Too many requests, please try again later." }
});
app.use(globalLimiter);

// Stricter limiter for sensitive endpoints
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many attempts, slow down." }
});
app.use("/api/validate-service", strictLimiter);
app.use("/save-transaction", strictLimiter);

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// 5.4 Generate CSP nonce
app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString("base64");
  next();
});

// 5.5 CSRF protection (hardened cookie)
const csrfProtection = csurf({
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict"
  }
});
app.use(csrfProtection);

// 5.6 Helmet security headers
app.use(helmet());                              // defaults: hidePoweredBy, noSniff, xssFilter, frameguard, hsts
app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'", "https://www.paypal.com", "https://*.paypal.com"],
    scriptSrc: [
      "'self'",
      (req, res) => `'nonce-${res.locals.nonce}'`,
      "'strict-dynamic'",
      "https://www.paypal.com",
      "https://*.paypal.com",
    ],
    styleSrc: ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "https://www.paypalobjects.com"],
    frameSrc: [
      "'self'",
      "https://www.paypal.com",
      "https://*.paypal.com",
      "https://www.sandbox.paypal.com",
    ],
    connectSrc: [
      "'self'",
      "https://www.paypal.com",
      "https://*.paypal.com",
      "https://www.sandbox.paypal.com",
    ],
    upgradeInsecureRequests: [],
  }
}));
app.use(helmet.referrerPolicy({ policy: "no-referrer" }));

// ───────────────────────────────────────────────────────────────────────────────
// 6. Routes
// ───────────────────────────────────────────────────────────────────────────────

// Home Route
app.get(
  "/",
  wrap((req, res) => {
    res.render("index", { nonce: res.locals.nonce, csrfToken: req.csrfToken() });
  })
);

// PayPal Config
app.get(
  "/config/paypal",
  wrap((req, res) => {
    if (!process.env.PAYPAL_CLIENT_ID) {
      throw new ApiError(500, "MISSING_PAYPAL_CLIENT_ID", "PayPal Client ID not found");
    }
    res.json({ clientId: process.env.PAYPAL_CLIENT_ID });
  })
);

// GET /api/services
app.get(
  "/api/services",
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT id, name, price FROM services ORDER BY id ASC"
    );
    res.json(rows);
  })
);

const router = express.Router();

// POST /api/validate-service
router.post(
  "/api/validate-service",
  [
    body("name")
      .trim()
      .notEmpty().withMessage("Service name is required.")
      .isString().withMessage("Service name must be a string.")
      .escape()
  ],
  wrap(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ApiError(400, "VALIDATION_ERROR", "Invalid input", errors.array());
    }
    const { name } = req.body;
    const { rows } = await pool.query(
      "SELECT name, price FROM services WHERE LOWER(name)=LOWER($1) LIMIT 1",
      [name]
    );
    if (!rows.length) {
      throw new ApiError(400, "SERVICE_NOT_FOUND", "Invalid service selection");
    }
    res.json(rows[0]);
  })
);

app.use(router);

// POST /save-transaction
app.post(
  "/save-transaction",
  [
    body("transaction_id").trim().notEmpty().withMessage("Transaction ID is required.").escape(),
    body("payer_name").trim().notEmpty().withMessage("Payer name is required.").escape(),
    body("payer_email").trim().isEmail().withMessage("A valid email is required.").normalizeEmail(),
    body("amount").trim().isNumeric().withMessage("Amount must be numeric."),
    body("currency").optional().trim().isLength({ min: 3, max: 3 }).escape(),
    body("payment_status").optional().trim().escape(),
    body("service_type").optional().trim().escape()
  ],
  wrap(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ApiError(400, "VALIDATION_ERROR", "Validation failed", errors.array());
    }

    const {
      transaction_id,
      payer_name,
      payer_email,
      amount,
      currency,
      payment_status,
      service_type,
    } = req.body;

    const query = `
      INSERT INTO transactions
        (transaction_id, payer_name, payer_email, amount, currency, payment_status, service_type)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const result = await pool.query(query, [
      transaction_id,
      payer_name,
      payer_email,
      amount,
      currency,
      payment_status,
      service_type,
    ]);

    transporter.sendMail(
      {
        from: process.env.EMAIL_USER,
        to: payer_email,
        subject: "Payment Confirmation",
        text: `Hello ${payer_name},\n\nYour transaction of $${amount} for ${service_type} was successful.\nTransaction ID: ${transaction_id}\n\nThank you for your business!`,
      },
      (err, info) => {
        if (err) {
          logger.error("❌ Error sending confirmation email:", { error: err.message, requestId: req.requestId });
        } else {
          logger.info("✅ Confirmation email sent", { info, requestId: req.requestId });
        }
      }
    );

    logger.info("✅ Transaction saved", { transaction_id, payer_email, amount, requestId: req.requestId });
    res.json({ success: true, message: "Transaction saved", transaction: result.rows[0] });
  })
);

// ───────────────────────────────────────────────────────────────────────────────
// 7. Global Error Handler
// ───────────────────────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (!(err instanceof ApiError)) {
    logger.error("❌ Unhandled Error", {
      message: err.message,
      stack: err.stack,
      requestId: req.requestId,
    });
    err = new ApiError(500, "INTERNAL_ERROR", "An unexpected error occurred");
  }

  logger.warn("⚠️ API Error Response", {
    status: err.statusCode,
    code: err.code,
    message: err.message,
    details: err.details,
    requestId: req.requestId,
  });

  res.status(err.statusCode).json({
    success: false,
    error: {
      code: err.code,
      message: err.message,
      requestId: req.requestId,
    },
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// 8. Start Server
// ───────────────────────────────────────────────────────────────────────────────
const port = process.env.PORT || 5000;
app.listen(port, "0.0.0.0", () =>
  logger.info(`✅ Server running on port ${port}`)
);



const compression = require("compression");

// ...



// ───────────────────────────────────────────────────────────────────────────────
// 5. Middleware Setup
// ───────────────────────────────────────────────────────────────────────────────

app.set("trust proxy", 1); // Required for secure cookies + IPs on Render/Heroku

// 5.0 Enable Gzip Compression
app.use(compression());

// 5.1 Assign a unique requestId
app.use((req, res, next) => {
  req.requestId = uuidv4();
  res.setHeader("X-Request-Id", req.requestId);
  res.setHeader("Connection", "keep-alive"); // Enable Keep-Alive
  next();
});

// 5.2 Express-Winston HTTP request logging
app.use(
  expressWinston.logger({
    winstonInstance: logger,
    meta: true,
    msg: "{{req.method}} {{req.url}} {{res.statusCode}} {{res.responseTime}}ms",
    expressFormat: false,
    colorize: false,
    dynamicMeta: (req, res) => ({
      requestId: req.requestId,
      userAgent: req.get("User-Agent"),
    }),
  })
);

app.use(cors());
app.use(bodyParser.json());
app.use(cookieParser());

// 5.3 Serve Static Files with Caching
app.use(
  express.static(path.join(__dirname, "public"), {
    maxAge: "30d", // Cache assets for 30 days
    etag: true,
    immutable: true,
  })
);

