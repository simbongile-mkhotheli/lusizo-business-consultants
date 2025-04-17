// server.js
require("dotenv-safe").config();

const cluster = require("cluster");
const os = require("os");
const numCPUs = os.cpus().length;

if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running — forking ${numCPUs} workers`);
  for (let i = 0; i < numCPUs; i++) cluster.fork();
  cluster.on("exit", (worker) => {
    console.warn(`Worker ${worker.process.pid} died, spawning replacement`);
    cluster.fork();
  });
  return;
}

// 1. Monitoring & Observability Setup
const client = require("prom-client");
client.collectDefaultMetrics();
const httpRequestDurationMs = new client.Histogram({
  name: "http_request_duration_ms",
  help: "Duration of HTTP requests in ms",
  labelNames: ["method", "route", "status_code"],
  buckets: [50,100,200,300,400,500,1000]
});

// 2. Imports & Logger
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

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp({ format: () => new Date().toLocaleString("en-US", { timeZone: "Africa/Johannesburg" }) }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "error.log", level: "error" }),
  ],
});

// 3. Postgres
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.connect((err, client, release) => {
  if (err) {
    logger.error("❌ PostgreSQL Connection Error:", { error: err.message });
    process.exit(1);
  }
  logger.info("✅ Connected to PostgreSQL on Render!"); release();
});

// 4. Mailer
const transporter = nodemailer.createTransport({
  service: "Gmail",
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// 5. ApiError + wrap
class ApiError extends Error {
  constructor(statusCode, code, message, details=null) {
    super(message); this.statusCode=statusCode; this.code=code; this.details=details;
  }
}
const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);

// 6. Middleware
app.set("trust proxy",1);
app.use(compression());
app.use((req,res,next) => {
  req.requestId = uuidv4();
  res.setHeader("X-Request-Id", req.requestId);
  res.setHeader("Connection","keep-alive");
  const end = httpRequestDurationMs.startTimer();
  res.on("finish",() => end({method:req.method, route:req.route?req.route.path:req.path, status_code:res.statusCode}));
  next();
});
app.use(expressWinston.logger({ winstonInstance: logger, meta:true, msg:"{{req.method}} {{req.url}} {{res.statusCode}} {{res.responseTime}}ms", expressFormat:false, colorize:false, dynamicMeta:(req)=>({requestId:req.requestId, userAgent:req.get("User-Agent")}) }));
app.use(cors()); app.use(bodyParser.json()); app.use(cookieParser());
app.use(express.static(path.join(__dirname,"public"),{ maxAge:"30d", etag:true, immutable:true }));

const globalLimiter = rateLimit({ windowMs:15*60*1000, max:100, message:{error:"Too many requests"} });
app.use(globalLimiter);
const strictLimiter = rateLimit({ windowMs:15*60*1000, max:20, message:{error:"Too many attempts"} });
app.use("/api/validate-service", strictLimiter);
app.use("/save-transaction", strictLimiter);

app.set("views", path.join(__dirname,"views"));
app.set("view engine","ejs");
app.use((req,res,next)=>{res.locals.nonce = crypto.randomBytes(16).toString("base64"); next();});
app.use(csurf({ cookie:{ httpOnly:true, secure: process.env.NODE_ENV==="production", sameSite:"strict" } }));
app.use(helmet());
app.use(helmet.contentSecurityPolicy({ directives:{ defaultSrc:["'self'","https://www.paypal.com"], scriptSrc:["'self'","'unsafe-eval'", req=>`'nonce-${res.locals.nonce}'`,"https://www.paypal.com"], styleSrc:["'self'","https://fonts.googleapis.com","'unsafe-inline'"], imgSrc:["'self'","data:","https://www.paypalobjects.com"], frameSrc:["'self'","https://www.paypal.com","https://*.paypal.com"], connectSrc:["'self'","https://www.paypal.com","https://*.paypal.com"], upgradeInsecureRequests:[] } }));
app.use(helmet.referrerPolicy({ policy:"no-referrer" }));

// 7. Metrics
app.get("/metrics", async (req,res)=>{ res.set("Content-Type", client.register.contentType); res.end(await client.register.metrics()); });

// 8. Routes
const router = express.Router();

// Health
router.get("/health", wrap(async (req,res)=>{ await pool.query("SELECT 1"); res.json({status:"ok", pid:process.pid}); }));

// Home
router.get("/", wrap((req,res)=>{ res.render("index",{ nonce:res.locals.nonce, csrfToken: req.csrfToken() }); }));

// PayPal config
router.get("/config/paypal", wrap((req,res)=>{ if (!process.env.PAYPAL_CLIENT_ID) throw new ApiError(500,"MISSING_PAYPAL_CLIENT_ID","PayPal Client ID not found"); res.json({ clientId: process.env.PAYPAL_CLIENT_ID }); }));

// Validate named
router.post(
  "/api/validate-service",
  [ body("name").trim().notEmpty().withMessage("Service name is required").isString().escape() ],
  wrap(async (req,res)=>{
    const errs = validationResult(req);
    if (!errs.isEmpty()) throw new ApiError(400,"VALIDATION_ERROR","Invalid input", errs.array());
    const { name } = req.body;
    const { rows } = await pool.query("SELECT name,price FROM services WHERE LOWER(name)=LOWER($1) LIMIT 1", [name]);
    if (!rows.length) throw new ApiError(400,"SERVICE_NOT_FOUND","Invalid service");
    if (rows[0].price < 300) throw new ApiError(400,"PRICE_TOO_LOW",`Service must be ≥300. Current: ${rows[0].price}`);
    res.json(rows[0]);
  })
);

// Validate custom
router.post(
  "/api/validate-custom",
  [ body("amount").isFloat({gt:0}).withMessage("Amount must be >0") ],
  wrap(async (req,res)=>{
    const errs = validationResult(req);
    if (!errs.isEmpty()) throw new ApiError(400,"VALIDATION_ERROR", errs.array()[0].msg);
    const { amount } = req.body;
    if (amount < 50) throw new ApiError(400,"AMOUNT_TOO_LOW",`Custom must be ≥50. You entered ${amount}`);
    res.json({ amount: amount.toFixed(2) });
  })
);

// Save transaction
router.post(
  "/save-transaction",
  [ body("transaction_id").notEmpty().escape(), body("payer_name").notEmpty().escape(), body("payer_email").isEmail().normalizeEmail(), body("amount").isNumeric(), body("currency").optional().isLength({min:3,max:3}).escape(), body("payment_status").optional().trim().escape(), body("service_type").optional().trim().escape() ],
  wrap(async (req,res)=>{
    const errs = validationResult(req);
    if (!errs.isEmpty()) throw new ApiError(400,"VALIDATION_ERROR","Validation failed", errs.array());
    const { transaction_id,payer_name,payer_email,amount,currency,payment_status,service_type } = req.body;
    const query = `INSERT INTO transactions (transaction_id,payer_name,payer_email,amount,currency,payment_status,service_type) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`;
    const result = await pool.query(query,[transaction_id,payer_name,payer_email,amount,currency,payment_status,service_type]);
    const mailOpts = { from: process.env.EMAIL_USER, to: payer_email, subject:"Payment Confirmation", text:`Hello ${payer_name},\nYour payment of ${currency}${amount} for ${service_type} was successful.\nTransaction ID: ${transaction_id}` };
    setImmediate(()=> transporter.sendMail(mailOpts,(err,info)=>{
      if (err) logger.error("❌ Email error",{error:err.message,requestId:req.requestId});
      else logger.info("✅ Email sent",{info,requestId:req.requestId});
    }));
    logger.info("✅ Transaction saved",{transaction_id,payer_email,amount,requestId:req.requestId});
    res.json({ success:true, transaction: result.rows[0] });
  })
);

// Mount API routes
app.use(router);

// 9. Error Handler
app.use((err,req,res,next)=>{
  if (!(err instanceof ApiError)) {
    logger.error("❌ Unhandled Error",{message:err.message, stack:err.stack, requestId:req.requestId});
    err = new ApiError(500,"INTERNAL_ERROR","An unexpected error occurred");
  }
  logger.warn("⚠️ API Error Response",{status:err.statusCode, code:err.code, message:err.message, details:err.details, requestId:req.requestId});
  res.status(err.statusCode).json({ success:false, error:{ code:err.code, message:err.message, requestId:req.requestId } });
});

// 10. Start Server
const port = process.env.PORT || 5000;
const server = app.listen(port, '0.0.0.0', ()=> logger.info(`Worker ${process.pid} listening on port ${port}`));
const shutdown = ()=>{
  logger.info(`Worker ${process.pid} shutting down…`);
  server.close(()=> pool.end(()=>{ logger.info(`DB pool closed. Exiting.`); process.exit(0); }));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

