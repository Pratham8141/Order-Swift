const router = require('express').Router();
const ctrl = require('../controllers/user.controller');
const { protect } = require('../middleware/auth');
const { validate, schemas } = require('../validations');

router.use(protect);

router.get('/profile',          ctrl.getProfile);
router.put('/profile',          validate(schemas.updateProfile), ctrl.updateProfile);
router.get('/addresses',        ctrl.getAddresses);
router.post('/address',         validate(schemas.address),       ctrl.addAddress);
router.put('/address/:id',      validate(schemas.address),       ctrl.updateAddress);
router.delete('/address/:id',                                    ctrl.deleteAddress);

module.exports = router;
