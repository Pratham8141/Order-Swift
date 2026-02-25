const router = require('express').Router();
const ctrl = require('../controllers/user.controller');
const { protect } = require('../middleware/auth');
const { validate, schemas } = require('../validations');

router.use(protect);

// Profile
router.get('/profile',          ctrl.getProfile);
router.put('/profile',          validate(schemas.updateProfile), ctrl.updateProfile);
router.put('/password',         validate(schemas.changePassword), ctrl.changePassword);
router.post('/push-token',      ctrl.savePushToken);

// Addresses
router.get('/addresses',        ctrl.getAddresses);
router.post('/address',         validate(schemas.address), ctrl.addAddress);
router.put('/address/:id',      validate(schemas.address), ctrl.updateAddress);
router.delete('/address/:id',   ctrl.deleteAddress);

// Favorites
router.get('/favorites',        ctrl.getFavorites);
router.get('/favorites/ids',    ctrl.getFavoriteIds);
router.post('/favorites/toggle',ctrl.toggleFavorite);

// Notifications
router.get('/notifications',             ctrl.getNotifications);
router.patch('/notifications/read-all',  ctrl.markAllNotificationsRead);
router.patch('/notifications/:id/read',  ctrl.markNotificationRead);

module.exports = router;
