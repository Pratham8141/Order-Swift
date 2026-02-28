const { db } = require('../db');
const { reviews, orders, restaurants } = require('../db/schema');
const { eq, avg, count, and, desc } = require('drizzle-orm');
const { AppError } = require('../utils/response');

const addReview = async (userId, { restaurantId, orderId, rating, comment }) => {
  // If orderId provided, verify it belongs to user and is delivered
  if (orderId) {
    const [order] = await db.select().from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.userId, userId))).limit(1);

    if (!order) throw new AppError('Order not found', 404);
    if (order.restaurantId !== restaurantId) throw new AppError('Order does not belong to this restaurant', 400);
    if (order.status !== 'collected') throw new AppError('Can only review collected (completed) orders', 400);
  }

  const [review] = await db.insert(reviews)
    .values({ userId, restaurantId, orderId, rating, comment })
    .returning();

  // Auto-update restaurant rating
  await _updateRestaurantRating(restaurantId);

  return review;
};

const getRestaurantReviews = async (restaurantId, page = 1, limit = 10) => {
  const offset = (page - 1) * limit;
  return db.select({
    id: reviews.id,
    rating: reviews.rating,
    comment: reviews.comment,
    createdAt: reviews.createdAt,
    userId: reviews.userId,
  }).from(reviews)
    .where(eq(reviews.restaurantId, restaurantId))
    .orderBy(desc(reviews.createdAt))
    .limit(limit)
    .offset(offset);
};

const _updateRestaurantRating = async (restaurantId) => {
  const [result] = await db
    .select({ avg: avg(reviews.rating), count: count(reviews.id) })
    .from(reviews)
    .where(eq(reviews.restaurantId, restaurantId));

  await db.update(restaurants)
    .set({
      rating: parseFloat(result.avg || 0).toFixed(2),
      totalReviews: parseInt(result.count),
      updatedAt: new Date(),
    })
    .where(eq(restaurants.id, restaurantId));
};

module.exports = { addReview, getRestaurantReviews };
