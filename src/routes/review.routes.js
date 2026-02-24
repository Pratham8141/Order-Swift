const router = require('express').Router();
const ctrl = require('../controllers/review.controller');
const { protect } = require('../middleware/auth');
const { validate, schemas } = require('../validations');

router.post('/', protect, validate(schemas.review), ctrl.addReview);

module.exports = router;
