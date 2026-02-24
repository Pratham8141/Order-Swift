/**
 * src/config/env.js
 * Validates all required environment variables at startup using Zod.
 * The server will NOT start if any required variable is missing or malformed.
 *
 * Import this as the FIRST thing in src/index.js (after dotenv.config()).
 */
const { z } = require('zod');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('5000'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_POOLER_URL: z.string().optional(),

  // JWT — must be at least 32 chars for security
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),

  // Razorpay
  RAZORPAY_KEY_ID: z.string().min(1, 'RAZORPAY_KEY_ID is required'),
  RAZORPAY_KEY_SECRET: z.string().min(1, 'RAZORPAY_KEY_SECRET is required'),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(), // optional — skip webhook verification if not set

  // SMS (optional in dev — OTPs print to console)
  FAST2SMS_API_KEY: z.string().optional(),

  // CORS
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000,http://localhost:19006'),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.string().default('600000'),
  RATE_LIMIT_MAX: z.string().default('100'),
  OTP_RATE_LIMIT_MAX: z.string().default('3'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('\n❌ STARTUP FAILED — Invalid environment variables:\n');
  const errors = parsed.error.flatten().fieldErrors;
  Object.entries(errors).forEach(([key, messages]) => {
    console.error(`  • ${key}: ${messages.join(', ')}`);
  });
  console.error(
    '\n→ Copy .env.example to .env and fill in the missing values.\n' +
    '→ Generate JWT secrets with:\n' +
    '  node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"\n'
  );
  process.exit(1);
}

module.exports = parsed.data;
