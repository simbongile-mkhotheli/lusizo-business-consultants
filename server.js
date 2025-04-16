// ───────────────────────────────────────────────────────────────────────────────
// 0. Environment Setup and Clustering
// ───────────────────────────────────────────────────────────────────────────────
require("dotenv-safe").config();

const cluster = require("cluster");
const os = require("os");
const numCPUs = os.cpus().length;

if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running — forking ${numCPUs} workers`);
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
  cluster.on("exit", (worker, code, signal) => {
    console.warn(`Worker ${worker.process.pid} died, spawning replacement`);
    cluster.fork();
  });
  // Master does not continue with the server code
  return;
}

// ───────────────────────────────────────────────────────────────────────────────
// 1. Monitoring & Observability Setup
// ───────────────────────────────────────────────────────────────────────────────
const Sentry = require("@sentry/node");
const Tracing = require("@sentry/tracing");
const client = require("prom-client");

// Initialize Sentry before any middleware uses its handlers
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
});

// Initialize Prometheus default metrics and custom HTTP duration histogram
client.collectDefaultMetrics();
const httpRequestDurationMs = new client.Histogram({
  name: "http_request_duration_ms",
  help: "Duration of HTTP requests in ms",
  labelNames: ["method", "route", "status_code"],
  buckets: [50, 100, 200, 300, 400, 500, 1000],
});

// ───────────────────────────────────────────────────────────────────────────────
// 2. Module Imports & Logger Setup
// ───────────────────────────────────────────────────────────────────────────────
const express = require("express");
const compression = require("compression");
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

// Winston Logger
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
// 3. Sentry Handlers (Place Before Other Middleware)
// ───────────────────────────────────────────────────────────────────────────────
app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.tracingHandler());

// ───────────────────────────────────────────────────────────────────────────────
// 4. PostgreSQL Connection Setup
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
// 5. Nodemailer Transporter Setup
// ───────────────────────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: "Gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ───────────────────────────────────────────────────────────────────────────────
// 6. Custom Error Class and Async Wrapper
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
// 7. Middleware Setup
// ───────────────────────────────────────────────────────────────────────────────
app.set("trust proxy", 1);
app.use(compression());

// Request ID and Prometheus timer middleware
app.use((req, res, next) => {
  req.requestId = uuidv4();
  res.setHeader("X-Request-Id", req.requestId);
  res.setHeader("Connection", "keep-alive");

  const end = httpRequestDurationMs.startTimer();
  res.on("finish", () => {
    const route = req.route ? req.route.path : req.path;
    end({ method: req.method, route, status_code: res.statusCode });
  });
  next();
});

// Winston request logging middleware
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

// Static assets middleware
app.use(
  express.static(path.join(__dirname, "public"), {
    maxAge: "30d",
    etag: true,
    immutable: true,
  })
);

// Global and route-specific rate limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Too many requests, please try again later." },
});
app.use(globalLimiter);

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many attempts, slow down." },
});
app.use("/api/validate-service", strictLimiter);
app.use("/save-transaction", strictLimiter);

// View engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// Inject a nonce for CSP
app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString("base64");
  next();
});

// CSRF protection middleware
app.use(
  csurf({
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    },
  })
);

// Helmet security middlewares
app.use(helmet());
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'", "https://www.paypal.com", "https://*.paypal.com"],
      scriptSrc: [
        "'self'",
        "'unsafe-eval'",
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
    },
  })
);
app.use(helmet.referrerPolicy({ policy: "no-referrer" }));

// ───────────────────────────────────────────────────────────────────────────────
// 8. Metrics Endpoint for Prometheus
// ───────────────────────────────────────────────────────────────────────────────
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});

// ───────────────────────────────────────────────────────────────────────────────
// 9. Route Definitions
// ───────────────────────────────────────────────────────────────────────────────

// Health Check Endpoint
app.get(
  "/health",
  wrap(async (req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok", pid: process.pid });
  })
);

// Home Route
app.get(
  "/",
  wrap((req, res) => {
    res.render("index", { nonce: res.locals.nonce, csrfToken: req.csrfToken() });
  })
);

// PayPal Config Endpoint
app.get(
  "/config/paypal",
  wrap((req, res) => {
    if (!process.env.PAYPAL_CLIENT_ID) {
      throw new ApiError(500, "MISSING_PAYPAL_CLIENT_ID", "PayPal Client ID not found");
    }
    res.json({ clientId: process.env.PAYPAL_CLIENT_ID });
  })
);

// GET /api/services Endpoint
app.get(
  "/api/services",
  wrap(async (req, res) => {
    const { rows } = await pool.query("SELECT id, name, price FROM services ORDER BY id ASC");
    res.json(rows);
  })
);

// Router for validating services
const router = express.Router();

router.post(
  "/api/validate-service",
  [
    body("name")
      .trim()
      .notEmpty()
      .withMessage("Service name is required.")
      .isString()
      .withMessage("Service name must be a string.")
      .escape(),
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

// POST /save-transaction Endpoint
app.post(
  "/save-transaction",
  [
    body("transaction_id").trim().notEmpty().withMessage("Transaction ID is required.").escape(),
    body("payer_name").trim().notEmpty().withMessage("Payer name is required.").escape(),
    body("payer_email").trim().isEmail().withMessage("A valid email is required.").normalizeEmail(),
    body("amount").trim().isNumeric().withMessage("Amount must be numeric."),
    body("currency").optional().trim().isLength({ min: 3, max: 3 }).escape(),
    body("payment_status").optional().trim().escape(),
    body("service_type").optional().trim().escape(),
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

    // Async email sending (fire‑and‑forget)
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: payer_email,
      subject: "Payment Confirmation",
      text: `Hello ${payer_name},\n\nYour transaction of $${amount} for ${service_type} was successful.\nTransaction ID: ${transaction_id}\n\nThank you for your business!`,
    };

    setImmediate(() => {
      transporter.sendMail(mailOptions, (err, info) => {
        if (err) {
          logger.error("❌ Error sending confirmation email:", {
            error: err.message,
            requestId: req.requestId,
          });
        } else {
          logger.info("✅ Confirmation email sent", {
            info,
            requestId: req.requestId,
          });
        }
      });
    });

    logger.info("✅ Transaction saved", {
      transaction_id,
      payer_email,
      amount,
      requestId: req.requestId,
    });
    res.json({ success: true, message: "Transaction saved", transaction: result.rows[0] });
  })
);

// ───────────────────────────────────────────────────────────────────────────────
// 10. Sentry Error Handler and Global Error Handler
// ───────────────────────────────────────────────────────────────────────────────
app.use(Sentry.Handlers.errorHandler());

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
// 11. Start Server & Graceful Shutdown
// ───────────────────────────────────────────────────────────────────────────────
const port = process.env.PORT || 5000;
const server = app.listen(port, "0.0.0.0", () =>
  logger.info(`Worker ${process.pid} listening on port ${port}`)
);

const shutdown = () => {
  logger.info(`Worker ${process.pid} shutting down…`);
  server.close(() => {
    pool.end(() => {
      logger.info(`Worker ${process.pid} DB pool closed. Exiting.`);
      process.exit(0);
    });
  });
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
