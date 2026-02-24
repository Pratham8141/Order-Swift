/**
 * src/utils/auditLog.js
 * Structured audit logging for admin actions.
 * All admin mutations (create/update/delete restaurant, change order status, etc.)
 * are logged here with who did what, when, and what changed.
 *
 * In production these logs go to the rotating log files alongside app logs,
 * but are clearly identifiable by the [AUDIT] prefix.
 */
const logger = require('./logger');

/**
 * Log an admin/system action.
 * @param {Object} params
 * @param {string} params.action       - e.g. 'restaurant.create', 'order.status_change'
 * @param {string} params.actorId      - ID of the user performing the action
 * @param {string} params.actorRole    - role of the actor (admin / restaurant_owner)
 * @param {string} [params.targetId]   - ID of the entity being acted on
 * @param {string} [params.targetType] - e.g. 'restaurant', 'order', 'menu_item'
 * @param {Object} [params.before]     - state before the change (for updates)
 * @param {Object} [params.after]      - state after the change (for updates)
 * @param {Object} [params.meta]       - any additional context
 */
const auditLog = ({
  action,
  actorId,
  actorRole,
  targetId = null,
  targetType = null,
  before = null,
  after = null,
  meta = {},
}) => {
  logger.info(`[AUDIT] ${action}`, {
    audit: true,
    action,
    actor: { id: actorId, role: actorRole },
    target: targetId ? { id: targetId, type: targetType } : null,
    changes: before || after ? { before, after } : null,
    meta,
    timestamp: new Date().toISOString(),
  });
};

module.exports = { auditLog };
