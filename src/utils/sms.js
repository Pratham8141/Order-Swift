const https = require('https');
const logger = require('./logger');

/**
 * Send OTP via Fast2SMS (works well in India)
 * Replace with Twilio / MSG91 as needed
 */
const sendSMS = async (phone, otp) => {
  console.log("DEV MODE OTP:", phone, otp);
  return true;


module.exports = { sendSMS };

module.exports = { sendSMS };

  const payload = JSON.stringify({
    route: 'otp',
    variables_values: otp,
    numbers: phone,
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.fast2sms.com',
      path: '/dev/bulkV2',
      method: 'POST',
      headers: {
        authorization: process.env.FAST2SMS_API_KEY,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.return) resolve({ success: true });
          else reject(new Error(parsed.message || 'SMS failed'));
        } catch {
          reject(new Error('SMS parse error'));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
};

module.exports = { sendSMS };
