/**
 * src/config/razorpay.js
 * Centralized Razorpay instance — import this everywhere instead of
 * creating new Razorpay() in each file.
 */
const Razorpay = require('razorpay');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

module.exports = razorpay;
