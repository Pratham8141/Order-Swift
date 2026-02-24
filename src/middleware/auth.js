const { verifyAccessToken } = require('../utils/jwt');
const { AppError } = require('../utils/response');
const { db } = require('../db');
const { users } = require('../db/schema');
const { eq } = require('drizzle-orm');

const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return next(new AppError('No token provided', 401));
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    const [user] = await db
      .select({ id: users.id, role: users.role, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, decoded.sub))
      .limit(1);

    if (!user) return next(new AppError('User not found', 401));
    if (!user.isActive) return next(new AppError('Account is deactivated', 403));

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') return next(new AppError('Token expired', 401));
    if (error.name === 'JsonWebTokenError') return next(new AppError('Invalid token', 401));
    next(error);
  }
};

const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) {
    return next(new AppError(`Role '${req.user?.role}' is not authorized for this action`, 403));
  }
  next();
};

module.exports = { protect, authorize };
