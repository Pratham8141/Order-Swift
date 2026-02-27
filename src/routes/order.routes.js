const router = require('express').Router();
const ctrl = require('../controllers/order.controller');
const { protect } = require('../middleware/auth');
const { validate, schemas } = require('../validations');

router.use(protect);

router.post('/',             validate(schemas.createOrder), ctrl.createOrder);
router.get('/',                                             ctrl.getOrders);
router.get('/:id',                                         ctrl.getOrderById);
router.patch('/:id/cancel',                                ctrl.cancelOrder);
router.post('/:id/reorder',                                ctrl.reorder);

module.exports = router;
