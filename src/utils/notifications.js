/**
 * src/utils/notifications.js
 * Creates in-app notifications when order status changes.
 * Extend this to also push via Expo Push Notifications.
 */
const { db } = require('../db');
const { notifications } = require('../db/schema');

const STATUS_MESSAGES = {
  confirmed:  { title: 'Order Confirmed! ✅',       body: 'Your order has been confirmed and will be prepared shortly.' },
  preparing:  { title: 'Preparing Your Order 👨‍🍳', body: 'The kitchen is now preparing your order.' },
  ready:      { title: 'Order Ready! 🎉',            body: 'Your order is ready for pickup!' },
  collected:  { title: 'Order Collected ✓',          body: 'Enjoy your meal! Thanks for ordering with us.' },
  cancelled:  { title: 'Order Cancelled ❌',         body: 'Your order has been cancelled. Contact the restaurant for details.' },
};

async function notifyOrderStatusChange(order) {
  const msg = STATUS_MESSAGES[order.status];
  if (!msg) return; // pending/paid — no notification needed

  await db.insert(notifications).values({
    userId:      order.userId,
    title:       msg.title,
    body:        msg.body,
    type:        'order_status',
    referenceId: order.id,
  });
}

module.exports = { notifyOrderStatusChange };
