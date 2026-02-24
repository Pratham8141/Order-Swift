/**
 * src/routes/admin.routes.js
 * All routes protected by JWT + role=admin.
 * Admin actions are audit-logged.
 */
const router = require('express').Router();
const restaurantCtrl = require('../controllers/restaurant.controller');
const menuService = require('../services/menu.service');
const orderCtrl = require('../controllers/order.controller');
const { protect, authorize } = require('../middleware/auth');
const { validate, schemas } = require('../validations');
const { asyncHandler, sendSuccess } = require('../utils/response');
const { auditLog } = require('../utils/auditLog');

// All admin routes require a valid JWT AND role=admin
router.use(protect, authorize('admin'));

// ─── Restaurants ──────────────────────────────────────────────────────────────
router.post('/restaurant',
  validate(schemas.restaurant),
  asyncHandler(async (req, res) => {
    const result = await restaurantCtrl._createRestaurant(req.body);
    auditLog({ action: 'restaurant.create', actorId: req.user.id, actorRole: req.user.role, targetId: result.id, targetType: 'restaurant', after: result });
    sendSuccess(res, result, 'Restaurant created', 201);
  })
);

router.put('/restaurant/:id',
  validate(schemas.restaurant),
  asyncHandler(async (req, res) => {
    const result = await restaurantCtrl._updateRestaurant(req.params.id, req.body);
    auditLog({ action: 'restaurant.update', actorId: req.user.id, actorRole: req.user.role, targetId: req.params.id, targetType: 'restaurant', after: req.body });
    sendSuccess(res, result, 'Restaurant updated');
  })
);

router.delete('/restaurant/:id',
  asyncHandler(async (req, res) => {
    await restaurantCtrl._deleteRestaurant(req.params.id);
    auditLog({ action: 'restaurant.delete', actorId: req.user.id, actorRole: req.user.role, targetId: req.params.id, targetType: 'restaurant' });
    sendSuccess(res, {}, 'Restaurant deleted');
  })
);

// ─── Menu Items ───────────────────────────────────────────────────────────────
router.post('/menu-item',
  validate(schemas.menuItem),
  asyncHandler(async (req, res) => {
    const result = await menuService.createMenuItem(req.body);
    auditLog({ action: 'menu_item.create', actorId: req.user.id, actorRole: req.user.role, targetId: result.id, targetType: 'menu_item', after: result });
    sendSuccess(res, result, 'Menu item created', 201);
  })
);

router.put('/menu-item/:id',
  asyncHandler(async (req, res) => {
    const result = await menuService.updateMenuItem(req.params.id, req.body);
    auditLog({ action: 'menu_item.update', actorId: req.user.id, actorRole: req.user.role, targetId: req.params.id, targetType: 'menu_item', after: req.body });
    sendSuccess(res, result, 'Menu item updated');
  })
);

// ─── Orders ───────────────────────────────────────────────────────────────────
router.get('/orders', orderCtrl.adminGetOrders);

router.patch('/order/:id/status',
  validate(schemas.orderStatus),
  asyncHandler(async (req, res) => {
    const result = await orderCtrl._adminUpdateStatus(req.params.id, req.body.status, req.body.estimatedTime);
    auditLog({ action: 'order.status_change', actorId: req.user.id, actorRole: req.user.role, targetId: req.params.id, targetType: 'order', after: { status: req.body.status } });
    sendSuccess(res, result, 'Order status updated');
  })
);

module.exports = router;
