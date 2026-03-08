'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireEventOwnership } = require('../middleware/eventOwnership');
const logger = require('../logger');

const router = express.Router();

// Read form templates once at startup
const FORMS_DIR = path.join(__dirname, '..', 'forms');
const MAIN_FORM_BYTES = fs.readFileSync(path.join(FORMS_DIR, 'ics-214.pdf'));
const PAGE2_FORM_BYTES = fs.readFileSync(path.join(FORMS_DIR, 'ics-214-page2.pdf'));

// Row capacity per section (derived from form field inspection)
const PAGE1_ROWS = 24;   // DateTimeRow1  … DateTimeRow24
const PAGE2A_ROWS = 24;  // DateTimeRow1_2 … DateTimeRow24_2
const PAGE2B_ROWS = 12;  // DateTimeRow25  … DateTimeRow36
const PAGE2_ROWS = PAGE2A_ROWS + PAGE2B_ROWS;     // 36 rows per continuation sheet
const MAIN_FORM_ROWS = PAGE1_ROWS + PAGE2_ROWS;   // 60 rows in base 2-page form

// ─── Formatting helpers ──────────────────────────────────────────────────────

function fmtDate(d) {
  const dt = new Date(d);
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${m}/${day}/${dt.getFullYear()}`;
}

function fmtTime(d) {
  const dt = new Date(d);
  return String(dt.getHours()).padStart(2, '0') + String(dt.getMinutes()).padStart(2, '0');
}

function fmtDT(d) {
  return `${fmtDate(d)} ${fmtTime(d)}`;
}

function safeFill(form, name, value) {
  try {
    form.getTextField(name).setText(String(value ?? ''));
  } catch (_) {
    // field absent in this template — skip silently
  }
}

// ─── Form builders ───────────────────────────────────────────────────────────

// Strategy: fill field values, regenerate AP streams via updateFieldAppearances
// (so widget annotations carry correct rendered text), then save WITHOUT
// flatten(). This avoids the doubled-text artifact caused by flatten() stamping
// the AP on top of Acrobat-baked page content. The updated AP streams travel
// with the annotations when pages are later copied into the merged document.

async function fillMainDoc(doc, font, event, updates, username) {
  const form = doc.getForm();
  const now = new Date();
  const opFrom = new Date(event.created_at);
  const opTo = updates.length > 0 ? new Date(updates[updates.length - 1].created_at) : now;

  // ── Page 1 header ──
  safeFill(form, '1 Incident Name_19', event.name);
  safeFill(form, '3 Name', username);
  safeFill(form, 'NameRow1_3', username);

  // ── Page 2 header (embedded in main form) ──
  safeFill(form, '1 Incident Name_20', event.name);
  safeFill(form, 'Date From', fmtDate(opFrom));
  safeFill(form, 'Date To',   fmtDate(opTo));
  safeFill(form, 'Time From', fmtTime(opFrom));
  safeFill(form, 'Time To',   fmtTime(opTo));

  // ── Page 1 activity rows (1-24) ──
  for (let i = 0; i < PAGE1_ROWS && i < updates.length; i++) {
    safeFill(form, `DateTimeRow${i + 1}`,          fmtDT(updates[i].created_at));
    safeFill(form, `Notable ActivitiesRow${i + 1}`, updates[i].content);
  }

  // ── Page 2 first block (DateTimeRow1_2 … 24_2) ──
  for (let i = 0; i < PAGE2A_ROWS; i++) {
    const ui = i + PAGE1_ROWS;
    if (ui >= updates.length) break;
    safeFill(form, `DateTimeRow${i + 1}_2`,          fmtDT(updates[ui].created_at));
    safeFill(form, `Notable ActivitiesRow${i + 1}_2`, updates[ui].content);
  }

  // ── Page 2 second block (DateTimeRow25 … 36) ──
  for (let i = 0; i < PAGE2B_ROWS; i++) {
    const ui = i + PAGE1_ROWS + PAGE2A_ROWS;
    if (ui >= updates.length) break;
    safeFill(form, `DateTimeRow${i + 25}`,          fmtDT(updates[ui].created_at));
    safeFill(form, `Notable ActivitiesRow${i + 25}`, updates[ui].content);
  }

  // ── Preparer ──
  safeFill(form, '8 Prepared by Name',   username);
  safeFill(form, 'DateTime_15',          fmtDT(now));
  safeFill(form, '8 Prepared by Name_2', username);
  safeFill(form, 'DateTime_16',          fmtDT(now));

  form.updateFieldAppearances(font);
}

async function fillExtraPage2Doc(doc, font, event, updates, offset, username) {
  const form = doc.getForm();
  const now = new Date();

  safeFill(form, '1 Incident Name_20', event.name);

  for (let i = 0; i < PAGE2A_ROWS; i++) {
    const ui = i + offset;
    if (ui >= updates.length) break;
    safeFill(form, `DateTimeRow${i + 1}_2`,          fmtDT(updates[ui].created_at));
    safeFill(form, `Notable ActivitiesRow${i + 1}_2`, updates[ui].content);
  }

  for (let i = 0; i < PAGE2B_ROWS; i++) {
    const ui = i + offset + PAGE2A_ROWS;
    if (ui >= updates.length) break;
    safeFill(form, `DateTimeRow${i + 25}`,          fmtDT(updates[ui].created_at));
    safeFill(form, `Notable ActivitiesRow${i + 25}`, updates[ui].content);
  }

  safeFill(form, '8 Prepared by Name_2', username);
  safeFill(form, 'DateTime_16',          fmtDT(now));

  form.updateFieldAppearances(font);
}

// ─── Route ───────────────────────────────────────────────────────────────────

router.get('/events/:id/export.pdf', requireAuth, requireEventOwnership, async (req, res) => {
  try {
    const event = req.event;
    if (event.deleted_at) return res.status(403).render('403');

    // Fetch all updates oldest-first (activity log order)
    const { rows: updates } = await pool.query(
      'SELECT * FROM updates WHERE event_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC',
      [event.id]
    );

    const username = req.session.user?.username || '';

    // Load and fill the base 2-page form. We keep mainDoc as the output
    // document so its AcroForm and embedded font resources stay intact —
    // copying pages into a blank doc loses those references and widgets
    // lose their appearance context in some viewers.
    const mainDoc = await PDFDocument.load(MAIN_FORM_BYTES);
    const mainFont = await mainDoc.embedFont(StandardFonts.Helvetica);
    await fillMainDoc(mainDoc, mainFont, event, updates, username);

    // Append continuation sheets for overflow updates directly into mainDoc.
    // Each extra doc is fully filled + AP-updated before its pages are copied.
    let offset = MAIN_FORM_ROWS;
    while (offset < updates.length) {
      const extraDoc = await PDFDocument.load(PAGE2_FORM_BYTES);
      const extraFont = await extraDoc.embedFont(StandardFonts.Helvetica);
      await fillExtraPage2Doc(extraDoc, extraFont, event, updates, offset, username);
      // Save+reload so pdf-lib treats the extra doc as a self-contained source
      const extraBytes = await extraDoc.save();
      const extraLoaded = await PDFDocument.load(extraBytes);
      const indices = [...Array(extraLoaded.getPageCount()).keys()];
      const copiedPages = await mainDoc.copyPages(extraLoaded, indices);
      copiedPages.forEach(p => mainDoc.addPage(p));
      offset += PAGE2_ROWS;
    }

    const pdfBytes = await mainDoc.save();
    const safeName = event.name.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');
    const filename = `ICS-214_${safeName}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBytes.byteLength);
    res.send(Buffer.from(pdfBytes));

    logger.info({ userId: req.session.userId, eventId: event.id, updateCount: updates.length }, 'ICS-214 exported');
  } catch (err) {
    logger.error({ err }, 'PDF export error');
    res.status(500).render('500');
  }
});

module.exports = router;
