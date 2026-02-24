const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const generateOTP = () => {
  // Cryptographically secure 6-digit OTP
  const buffer = crypto.randomBytes(3);
  const otp = (parseInt(buffer.toString('hex'), 16) % 900000 + 100000).toString();
  return otp;
};

const hashOTP = async (otp) => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(otp, salt);
};

const verifyOTP = (otp, hash) => bcrypt.compare(otp, hash);

module.exports = { generateOTP, hashOTP, verifyOTP };
