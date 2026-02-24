const router = require('express').Router();
const ctrl = require('../controllers/cart.controller');
const { protect } = require('../middleware/auth');
const { validate, schemas } = require('../validations');

router.use(protect);

router.get('/',          ctrl.getCart);
router.post('/add',      validate(schemas.addToCart),   ctrl.addToCart);
router.put('/update',    validate(schemas.updateCart),  ctrl.updateCart);
router.delete('/remove', validate(schemas.removeCart),  ctrl.removeItem);
router.delete('/clear',                                 ctrl.clearCart);

module.exports = router;
