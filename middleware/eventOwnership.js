'use strict';

const { pool } = require('../db');
const logger = require('../logger');

// Loads the event identified by :id or :eventId, verifies the current user
// owns it, and attaches it to req.event. Returns 403 if not found or not owned.
// Does NOT filter by deleted_at — routes that only serve live events should
// check req.event.deleted_at themselves.
async function requireEventOwnership(req, res, next) {
  const eventId = req.params.id ?? req.params.eventId;
  try {
    const { rows } = await pool.query(
      'SELECT * FROM events WHERE id = $1 AND user_id = $2',
      [eventId, req.session.userId]
    );
    const event = rows[0];
    if (!event) return res.status(403).render('403');
    req.event = event;
    next();
  } catch (err) {
    logger.error({ err }, 'Event ownership check error');
    res.status(500).render('500');
  }
}

module.exports = { requireEventOwnership };
