const { db } = require('../db');
const { users, otps, refreshTokens } = require('../db/schema');
const { eq, and, gt, desc } = require('drizzle-orm');
const { generateOTP, hashOTP, verifyOTP } = require('../utils/otp');
const { generateTokenPair } = require('../utils/jwt');
const { sendSMS } = require('../utils/sms');
const { AppError } = require('../utils/response');
const { OAuth2Client } = require('google-auth-library');
const logger = require('../utils/logger');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ─── Constants ────────────────────────────────────────────────────────────────
const SELF_ASSIGNABLE_ROLES = ['user', 'restaurant_owner'];

// ─── Internal guards ──────────────────────────────────────────────────────────

const _rejectAdminRole = (role) => {
  if (role === 'admin') {
    throw new AppError(
      'The "admin" role cannot be self-assigned. Contact a system administrator.',
      400
    );
  }
};

const _validateSelfAssignableRole = (role) => {
  if (!SELF_ASSIGNABLE_ROLES.includes(role)) {
    throw new AppError(
      `Invalid role "${role}". Allowed values: ${SELF_ASSIGNABLE_ROLES.join(', ')}.`,
      400
    );
  }
};

// ─── checkPhoneExists (Issue #4) ──────────────────────────────────────────────

/**
 * checkPhoneExists(phone)
 *
 * Called by the login screen BEFORE sending OTP.
 * Returns { exists: boolean } so the frontend can route the user correctly:
 *   - exists: true  → proceed to OTP screen (login flow)
 *   - exists: false → redirect to Register screen (registration flow)
 *
 * Does NOT send an OTP. Does NOT create any records. Pure read.
 */
const checkPhoneExists = async (phone) => {
  logger.debug('checkPhoneExists', { phone: phone.slice(0, 6) + '****' }); // #9

  const [user] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.phone, phone))
    .limit(1);

  return { exists: !!user };
};

// ─── sendOtp ──────────────────────────────────────────────────────────────────

/**
 * sendOtp(phone, requestedRole?)
 *
 * Sends an OTP. Role accepted for UX flow — applied only if creating new account.
 * Security: "admin" rejected immediately. Role only applied in verifyOtp for new users.
 */
const sendOtp = async (phone, requestedRole) => {
  if (requestedRole) {
    _rejectAdminRole(requestedRole);
  }

  const otp = generateOTP();
  const otpHash = await hashOTP(otp);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min

  // Invalidate any previous unused OTPs for this phone
  await db.update(otps)
    .set({ used: true })
    .where(and(eq(otps.phone, phone), eq(otps.used, false)));

  await db.insert(otps).values({ phone, otpHash, expiresAt });

  await sendSMS(phone, otp);
  logger.info('OTP sent', { phone: phone.slice(0, 6) + '****' });

  return { message: 'OTP sent successfully' };
};

// ─── verifyOtp ────────────────────────────────────────────────────────────────

/**
 * verifyOtp(phone, otp, requestedRole?)
 *
 * Account logic:
 *  - User EXISTS: stored role used always. requestedRole ignored.
 *  - User NOT EXIST: roleToAssign = requestedRole === 'restaurant_owner'
 *                    ? 'restaurant_owner' : 'user'
 */
const verifyOtp = async (phone, otp, requestedRole) => {
  if (requestedRole) {
    _rejectAdminRole(requestedRole);
  }

  const now = new Date();

  const [record] = await db
    .select()
    .from(otps)
    .where(and(eq(otps.phone, phone), eq(otps.used, false), gt(otps.expiresAt, now)))
    .orderBy(desc(otps.createdAt))
    .limit(1);

  if (!record) {
    throw new AppError('OTP expired or not found. Please request a new one.', 400);
  }

  const isValid = await verifyOTP(otp, record.otpHash);
  if (!isValid) {
    const newAttempts = record.attempts + 1;

    await db.update(otps)
      .set({ attempts: newAttempts })
      .where(eq(otps.id, record.id));

    if (newAttempts >= 5) {
      await db.update(otps).set({ used: true }).where(eq(otps.id, record.id));
      throw new AppError('Too many incorrect attempts. Please request a new OTP.', 400);
    }

    throw new AppError(`Invalid OTP. ${5 - newAttempts} attempt(s) remaining.`, 400);
  }

  await db.update(otps).set({ used: true }).where(eq(otps.id, record.id));

  const [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.phone, phone))
    .limit(1);

  let user;
  let isNewUser;

  if (existingUser) {
    if (requestedRole && requestedRole !== existingUser.role) {
      logger.warn('Role change attempt on existing account — ignored', {
        userId: existingUser.id,
        storedRole: existingUser.role,
        requestedRole,
      });
    }
    user = existingUser;
    isNewUser = false;

  } else {
    const roleToAssign =
      requestedRole === 'restaurant_owner' ? 'restaurant_owner' : 'user';

    _validateSelfAssignableRole(roleToAssign);

    [user] = await db
      .insert(users)
      .values({ phone, role: roleToAssign })
      .returning();

    logger.info('New user registered via OTP', { userId: user.id, role: user.role });
    isNewUser = true;
  }

  const tokens = await _issueTokens(user);

  return {
    user: _safeUser(user),
    ...tokens,
    isNewUser,
  };
};

// ─── Google Auth ──────────────────────────────────────────────────────────────

const googleLogin = async (idToken) => {
  let ticket;
  try {
    ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
  } catch {
    throw new AppError('Invalid Google token', 401);
  }

  const { sub: googleId, email, name, picture } = ticket.getPayload();

  let [user] = await db.select().from(users)
    .where(eq(users.googleId, googleId)).limit(1);

  if (!user && email) {
    [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  }

  if (user) {
    if (!user.googleId) {
      [user] = await db.update(users)
        .set({ googleId, updatedAt: new Date() })
        .where(eq(users.id, user.id))
        .returning();
    }
  } else {
    [user] = await db.insert(users)
      .values({ googleId, email, name, avatar: picture, role: 'user' })
      .returning();
    logger.info('New user created via Google', { userId: user.id });
  }

  const tokens = await _issueTokens(user);
  return { user: _safeUser(user), ...tokens };
};

// ─── Refresh Token ────────────────────────────────────────────────────────────

const refreshAccessToken = async (token) => {
  const { verifyRefreshToken, generateAccessToken } = require('../utils/jwt');

  let decoded;
  try {
    decoded = verifyRefreshToken(token);
  } catch {
    throw new AppError('Invalid or expired refresh token', 401);
  }

  const [stored] = await db.select().from(refreshTokens)
    .where(and(eq(refreshTokens.token, token), gt(refreshTokens.expiresAt, new Date())))
    .limit(1);

  if (!stored) throw new AppError('Refresh token revoked or expired', 401);

  const [user] = await db.select().from(users)
    .where(eq(users.id, decoded.sub)).limit(1);

  if (!user || !user.isActive) throw new AppError('User not found or deactivated', 401);

  const accessToken = generateAccessToken({ sub: user.id, role: user.role });
  return { accessToken };
};

// ─── Logout ───────────────────────────────────────────────────────────────────

const logout = async (token) => {
  if (token) {
    await db.delete(refreshTokens).where(eq(refreshTokens.token, token));
  }
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

const _issueTokens = async (user) => {
  const tokens = generateTokenPair(user);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await db.insert(refreshTokens).values({
    userId: user.id,
    token: tokens.refreshToken,
    expiresAt,
  });

  return tokens;
};

const _safeUser = (user) => ({
  id:     user.id,
  name:   user.name,
  email:  user.email,
  phone:  user.phone,
  avatar: user.avatar,
  role:   user.role,
});

module.exports = {
  checkPhoneExists,
  sendOtp,
  verifyOtp,
  googleLogin,
  refreshAccessToken,
  logout,
};
