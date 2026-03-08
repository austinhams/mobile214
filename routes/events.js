const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireEventOwnership } = require('../middleware/eventOwnership');
const logger = require('../logger');
const { PAGE_SIZE, SOFT_DELETE_PURGE_INTERVAL, EVENT_NAME_MAX, EVENT_DESC_MAX, DASHBOARD_PAGE_SIZE, UPDATE_CONTENT_MAX } = require('../config');

const router = express.Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getEventPage(eventId, page) {
  const { rows: [{ count }] } = await pool.query(
    'SELECT COUNT(*) AS count FROM updates WHERE event_id = $1 AND deleted_at IS NULL',
    [eventId]
  );
  const totalCount = parseInt(count);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const offset = (currentPage - 1) * PAGE_SIZE;
  const { rows: updates } = await pool.query(
    'SELECT * FROM updates WHERE event_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT $2 OFFSET $3',
    [eventId, PAGE_SIZE, offset]
  );
  return { updates, totalCount, currentPage, totalPages };
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

async function getDashboardPage(userId, page) {
  const { rows: [{ count }] } = await pool.query(
    'SELECT COUNT(*) AS count FROM events WHERE user_id = $1 AND deleted_at IS NULL',
    [userId]
  );
  const totalCount = parseInt(count);
  const totalPages = Math.max(1, Math.ceil(totalCount / DASHBOARD_PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const offset = (currentPage - 1) * DASHBOARD_PAGE_SIZE;
  const { rows: events } = await pool.query(
    `SELECT e.*, COUNT(u.id)::int AS update_count
     FROM events e
     LEFT JOIN updates u ON u.event_id = e.id AND u.deleted_at IS NULL
     WHERE e.user_id = $1 AND e.deleted_at IS NULL
     GROUP BY e.id
     ORDER BY e.created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, DASHBOARD_PAGE_SIZE, offset]
  );
  return { events, currentPage, totalPages };
}

router.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const { events, currentPage, totalPages } = await getDashboardPage(req.session.userId, page);
    const undoAction = req.session.pendingUndo || null;
    delete req.session.pendingUndo;
    res.render('dashboard', { events, currentPage, totalPages, error: null, undoAction });
  } catch (err) {
    logger.error({ err }, 'Dashboard error');
    res.status(500).render('500');
  }
});

// ─── Events ─────────────────────────────────────────────────────────────────

router.post('/events', requireAuth, async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) {
      const { events, currentPage, totalPages } = await getDashboardPage(req.session.userId, 1);
      return res.render('dashboard', { events, currentPage, totalPages, error: 'Event name is required.', undoAction: null });
    }
    if (name.length > EVENT_NAME_MAX) {
      const { events, currentPage, totalPages } = await getDashboardPage(req.session.userId, 1);
      return res.render('dashboard', { events, currentPage, totalPages, error: `Event name must be ${EVENT_NAME_MAX} characters or fewer.`, undoAction: null });
    }
    if (description && description.length > EVENT_DESC_MAX) {
      const { events, currentPage, totalPages } = await getDashboardPage(req.session.userId, 1);
      return res.render('dashboard', { events, currentPage, totalPages, error: `Description must be ${EVENT_DESC_MAX} characters or fewer.`, undoAction: null });
    }

    await pool.query(
      'INSERT INTO events (user_id, name, description) VALUES ($1, $2, $3)',
      [req.session.userId, name, description || null]
    );
    logger.info({ userId: req.session.userId, name }, 'Event created');
    res.redirect('/dashboard');
  } catch (err) {
    logger.error({ err }, 'Create event error');
    res.status(500).render('500');
  }
});

router.get('/events/:id', requireAuth, requireEventOwnership, async (req, res) => {
  try {
    const event = req.event;
    if (event.deleted_at) return res.status(404).render('404');

    const page = parseInt(req.query.page) || 1;
    const { updates, totalCount, currentPage, totalPages } = await getEventPage(event.id, page);

    const undoAction = req.session.pendingUndo || null;
    delete req.session.pendingUndo;
    res.render('event', { event, updates, totalCount, currentPage, totalPages, updateContentMax: UPDATE_CONTENT_MAX, error: null, undoAction });
  } catch (err) {
    logger.error({ err }, 'Load event error');
    res.status(500).render('500');
  }
});

router.post('/events/:id/restore', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'UPDATE events SET deleted_at = NULL WHERE id = $1 AND user_id = $2',
      [req.params.id, req.session.userId]
    );
    logger.info({ userId: req.session.userId, eventId: req.params.id }, 'Event restored');
    res.redirect('/dashboard');
  } catch (err) {
    logger.error({ err }, 'Restore event error');
    res.status(500).render('500');
  }
});

router.post('/events/:id/edit', requireAuth, requireEventOwnership, async (req, res) => {
  try {
    const event = req.event;

    const { name, description } = req.body;
    if (!name) return res.redirect('/events/' + event.id);
    if (name.length > EVENT_NAME_MAX) return res.redirect('/events/' + event.id);
    if (description && description.length > EVENT_DESC_MAX) return res.redirect('/events/' + event.id);

    await pool.query(
      'UPDATE events SET name = $1, description = $2 WHERE id = $3',
      [name, description || null, event.id]
    );
    logger.info({ userId: req.session.userId, eventId: event.id }, 'Event updated');
    res.redirect('/events/' + event.id);
  } catch (err) {
    logger.error({ err }, 'Edit event error');
    res.status(500).render('500');
  }
});

router.post('/events/:id/delete', requireAuth, requireEventOwnership, async (req, res) => {
  try {
    const event = req.event;

    await pool.query('UPDATE events SET deleted_at = NOW() WHERE id = $1', [event.id]);
    // Hard-purge any soft-deleted records older than the undo window
    await pool.query(`DELETE FROM updates WHERE deleted_at < NOW() - INTERVAL '${SOFT_DELETE_PURGE_INTERVAL}'`);
    await pool.query(`DELETE FROM events  WHERE deleted_at < NOW() - INTERVAL '${SOFT_DELETE_PURGE_INTERVAL}'`);
    logger.info({ userId: req.session.userId, eventId: event.id }, 'Event soft-deleted');
    req.session.pendingUndo = {
      message: `"${event.name}" deleted.`,
      restoreUrl: `/events/${event.id}/restore`,
    };
    res.redirect('/dashboard');
  } catch (err) {
    logger.error({ err }, 'Delete event error');
    res.status(500).render('500');
  }
});

// ─── Updates ────────────────────────────────────────────────────────────────

router.post('/events/:id/updates', requireAuth, requireEventOwnership, async (req, res) => {
  try {
    const event = req.event;

    const { content } = req.body;
    const { updates, totalCount, totalPages } = await getEventPage(event.id, 1);

    if (!content) {
      return res.render('event', { event, updates, totalCount, currentPage: 1, totalPages, updateContentMax: UPDATE_CONTENT_MAX, error: 'Update cannot be empty.', undoAction: null });
    }
    if (content.length > UPDATE_CONTENT_MAX) {
      return res.render('event', { event, updates, totalCount, currentPage: 1, totalPages, updateContentMax: UPDATE_CONTENT_MAX, error: `Update must be ${UPDATE_CONTENT_MAX} characters or fewer.`, undoAction: null });
    }

    await pool.query(
      'INSERT INTO updates (event_id, content) VALUES ($1, $2)',
      [event.id, content]
    );
    logger.info({ userId: req.session.userId, eventId: event.id }, 'Update created');
    res.redirect('/events/' + event.id + '?page=1#add-update');
  } catch (err) {
    logger.error({ err }, 'Create update error');
    res.status(500).render('500');
  }
});

router.post('/events/:eventId/updates/:updateId/edit', requireAuth, requireEventOwnership, async (req, res) => {
  try {
    const event = req.event;

    const page = req.query.page || 1;
    const { content } = req.body;

    if (!content || content.length > UPDATE_CONTENT_MAX) {
      return res.redirect('/events/' + event.id + '?page=' + page);
    }

    await pool.query(
      'UPDATE updates SET content = $1 WHERE id = $2 AND event_id = $3',
      [content, req.params.updateId, event.id]
    );
    logger.info({ userId: req.session.userId, eventId: event.id, updateId: req.params.updateId }, 'Update edited');
    res.redirect('/events/' + event.id + '?page=' + page);
  } catch (err) {
    logger.error({ err }, 'Edit update error');
    res.status(500).render('500');
  }
});

router.post('/events/:eventId/updates/:updateId/delete', requireAuth, requireEventOwnership, async (req, res) => {
  try {
    const event = req.event;

    await pool.query(
      'UPDATE updates SET deleted_at = NOW() WHERE id = $1 AND event_id = $2',
      [req.params.updateId, event.id]
    );
    // Hard-purge soft-deleted updates older than the undo window
    await pool.query(`DELETE FROM updates WHERE deleted_at < NOW() - INTERVAL '${SOFT_DELETE_PURGE_INTERVAL}'`);
    logger.info({ userId: req.session.userId, eventId: event.id, updateId: req.params.updateId }, 'Update soft-deleted');

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const { rows: [{ count }] } = await pool.query(
      'SELECT COUNT(*) AS count FROM updates WHERE event_id = $1 AND deleted_at IS NULL',
      [event.id]
    );
    const newTotalPages = Math.max(1, Math.ceil(parseInt(count) / PAGE_SIZE));
    const redirectPage = Math.min(page, newTotalPages);

    req.session.pendingUndo = {
      message: 'Update deleted.',
      restoreUrl: `/events/${event.id}/updates/${req.params.updateId}/restore`,
    };
    res.redirect('/events/' + event.id + '?page=' + redirectPage);
  } catch (err) {
    logger.error({ err }, 'Delete update error');
    res.status(500).render('500');
  }
});

router.post('/events/:eventId/updates/:updateId/restore', requireAuth, requireEventOwnership, async (req, res) => {
  try {
    const event = req.event;

    await pool.query(
      'UPDATE updates SET deleted_at = NULL WHERE id = $1 AND event_id = $2',
      [req.params.updateId, event.id]
    );
    logger.info({ userId: req.session.userId, eventId: event.id, updateId: req.params.updateId }, 'Update restored');
    res.redirect('/events/' + event.id);
  } catch (err) {
    logger.error({ err }, 'Restore update error');
    res.status(500).render('500');
  }
});

module.exports = router;
