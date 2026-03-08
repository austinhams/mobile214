const { pool } = require('../db');
const logger = require('../logger');

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  next();
}

async function attachCurrentUser(req, res, next) {
  res.locals.currentUser = null;
  if (req.session.userId) {
    if (req.session.user) {
      res.locals.currentUser = req.session.user;
    } else {
      try {
        const { rows } = await pool.query(
          'SELECT id, username, email FROM users WHERE id = $1',
          [req.session.userId]
        );
        req.session.user = rows[0] || null;
        res.locals.currentUser = req.session.user;
      } catch (err) {
        logger.error({ err }, 'Failed to fetch current user');
      }
    }
  }
  next();
}

module.exports = { requireAuth, attachCurrentUser };
