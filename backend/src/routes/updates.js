/**
 * src/routes/updates.js
 * GET  /api/updates/:projectId        — list updates for a project
 * POST /api/updates                   — create update + notify subscribers (admin)
 * POST /api/updates/:updateId/like — toggle like
 * GET  /api/updates/:updateId/likes — get like count and user's like status
 *
 * Rate limiters prevent admin update spam and like enumeration/spam.
 */
"use strict";
const express = require("express");
const router  = express.Router();
const { v4: uuidv4 } = require("uuid");
const pool = require("../db/pool");
const { createLayeredRateLimiter } = require("../middleware/rateLimiter");
const { mapProjectUpdateRow, mapProjectRow } = require("../services/store");
const { enqueueUpdateNotifications } = require("../services/email");
const { sendUpdatePushNotifications } = require("../services/push");
const { logAdminAction } = require("../services/audit");

const { adminRequired } = require("../middleware/auth");
const { createApiError } = require("../middleware/apiEnvelope");
const {
  TRANSLATION_STATUSES,
  requireContentLanguage,
  updateLocalizationSelect,
} = require("../services/contentLanguage");

// Rate limiter for admin update creation: an IP floor plus the real cap on the
// authenticated subject, so the same admin account is bounded regardless of
// which address it logs in from. 5 updates per admin per hour.
const updateCreationLimiter = createLayeredRateLimiter({
  name: "update-create",
  windowMinutes: 60,
  ip: 30,
  subject: 5,
});

// Rate limiter for like operations: coarse per-IP floor plus the real
// per-wallet cap. Prevents like enumeration/spam: 20 likes per donor per hour.
const likeLimiter = createLayeredRateLimiter({
  name: "update-like",
  windowMinutes: 1,
  ip: 60,
  wallet: 20,
});

// GET /api/updates/:projectId — list updates for a project, newest first
router.get("/:projectId", async (req, res, next) => {
  try {
    const language = req.query.lang === undefined ? null : requireContentLanguage(req.query.lang);
    const values = [req.params.projectId];
    let languageParam = null;
    if (language) {
      values.push(language);
      languageParam = `$${values.length}`;
    }
    const localization = updateLocalizationSelect(languageParam);
    const result = await pool.query(
      `SELECT u.*${localization.columns}${languageParam ? `, ${languageParam}::text AS requested_language` : ""}
       FROM project_updates u${localization.join}
       WHERE u.project_id = $1 ORDER BY u.created_at DESC`,
      values,
    );
    res.json(result.rows.map(mapProjectUpdateRow));
  } catch (e) {
    next(e);
  }
});

// POST /api/updates  (admin only)
// Rate-limited to prevent update spam
router.post("/", adminRequired, updateCreationLimiter, async (req, res, next) => {
  try {
    const { projectId, title, body } = req.body || {};
    const sourceLanguage = req.body?.sourceLanguage === undefined
      ? "en"
      : requireContentLanguage(req.body.sourceLanguage);

    if (!projectId || typeof projectId !== "string") {
      throw createApiError(400, "PROJECT_ID_REQUIRED", "projectId is required");
    }
    if (!title || typeof title !== "string" || !title.trim()) {
      throw createApiError(400, "TITLE_REQUIRED", "title is required");
    }
    if (!body || typeof body !== "string" || !body.trim()) {
      throw createApiError(400, "BODY_REQUIRED", "body is required");
    }

    // Verify project exists
    const projResult = await pool.query("SELECT * FROM projects WHERE id = $1", [projectId]);
    if (!projResult.rows[0]) {
      throw createApiError(404, "PROJECT_NOT_FOUND", "Project not found");
    }
    const project = mapProjectRow(projResult.rows[0]);

    // Insert update
    const id = uuidv4();
    const insertResult = await pool.query(
      `INSERT INTO project_updates (id, project_id, title, body, source_language)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, projectId, title.trim(), body.trim(), sourceLanguage],
    );
    const update = mapProjectUpdateRow(insertResult.rows[0]);

    // Fan out email notifications (non-blocking): reads subscribers in
    // bounded chunks and enqueues one retryable job per chunk rather than
    // loading every subscriber into memory and sending inline.
    enqueueUpdateNotifications({ project, update }).catch((err) => {
      console.error("[updates] Failed to enqueue email notifications:", err.message);
    });

    // Fan out push notifications (non-blocking): same chunked-queue pattern
    // for followers' device tokens.
    sendUpdatePushNotifications({ project, update }).catch((err) => {
      console.error("[updates] Failed to enqueue push notifications:", err.message);
    });

    res.status(201).json(update);
  } catch (e) {
    next(e);
  }
});

router.put("/:updateId/translations/:language", adminRequired, updateCreationLimiter, async (req, res, next) => {
  try {
    const language = requireContentLanguage(req.params.language);
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!title || !body) {
      throw createApiError(400, "TRANSLATION_FIELDS_REQUIRED", "title and body are required");
    }
    const original = await pool.query("SELECT id, source_language FROM project_updates WHERE id = $1", [req.params.updateId]);
    if (!original.rows[0]) {
      throw createApiError(404, "UPDATE_NOT_FOUND", "Update not found");
    }
    if (language === original.rows[0].source_language) {
      throw createApiError(409, "SOURCE_LANGUAGE_TRANSLATION", "A translation cannot replace the original language");
    }
    const result = await pool.query(
      `INSERT INTO project_update_translations
        (id, update_id, language, title, body, machine_translated, moderation_status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       ON CONFLICT (update_id, language) DO UPDATE SET
         title = EXCLUDED.title, body = EXCLUDED.body,
         machine_translated = EXCLUDED.machine_translated,
         impact_claims_reviewed = FALSE, moderation_status = 'pending', updated_at = NOW()
       RETURNING *`,
      [uuidv4(), req.params.updateId, language, title, body, req.body.machineTranslated === true],
    );
    logAdminAction({
      actor: req.admin.sub,
      action: "project_update.translation.submitted",
      targetType: "project_update_translation",
      targetId: result.rows[0].id,
      metadata: { updateId: req.params.updateId, language },
      ipAddress: req.ip,
    });
    res.status(201).json(result.rows[0]);
  } catch (e) {
    next(e);
  }
});

router.patch("/:updateId/translations/:language/moderation", adminRequired, updateCreationLimiter, async (req, res, next) => {
  try {
    const language = requireContentLanguage(req.params.language);
    const { status, impactClaimsReviewed = false } = req.body || {};
    if (!TRANSLATION_STATUSES.includes(status)) {
      throw createApiError(400, "TRANSLATION_STATUS_INVALID", `status must be one of: ${TRANSLATION_STATUSES.join(", ")}`);
    }
    const existing = await pool.query(
      "SELECT * FROM project_update_translations WHERE update_id = $1 AND language = $2",
      [req.params.updateId, language],
    );
    if (!existing.rows[0]) {
      throw createApiError(404, "UPDATE_TRANSLATION_NOT_FOUND", "Update translation not found");
    }
    if (status === "approved" && existing.rows[0].machine_translated && impactClaimsReviewed !== true) {
      throw createApiError(400, "IMPACT_CLAIMS_REVIEW_REQUIRED", "Machine-translated impact claims require human review before approval");
    }
    const result = await pool.query(
      `UPDATE project_update_translations SET moderation_status = $1,
         impact_claims_reviewed = $2, updated_at = NOW()
       WHERE update_id = $3 AND language = $4 RETURNING *`,
      [status, impactClaimsReviewed === true, req.params.updateId, language],
    );
    logAdminAction({
      actor: req.admin.sub,
      action: `project_update.translation.${status}`,
      targetType: "project_update_translation",
      targetId: result.rows[0].id,
      metadata: { updateId: req.params.updateId, language, impactClaimsReviewed: impactClaimsReviewed === true },
      ipAddress: req.ip,
    });
    res.json(result.rows[0]);
  } catch (e) {
    next(e);
  }
});

// POST /api/updates/:updateId/like — toggle like
// Rate-limited per donor to prevent like enumeration/spam
router.post("/:updateId/like", likeLimiter, async (req, res, next) => {
  try {
    const { donorAddress } = req.body || {};
    if (!donorAddress || typeof donorAddress !== "string") {
      throw createApiError(400, "DONOR_ADDRESS_REQUIRED", "donorAddress is required");
    }

    const updateResult = await pool.query(
      "SELECT id FROM project_updates WHERE id = $1",
      [req.params.updateId],
    );
    if (!updateResult.rows[0]) {
      throw createApiError(404, "UPDATE_NOT_FOUND", "Update not found");
    }

    // Check if already liked
    const existing = await pool.query(
      "SELECT id FROM update_likes WHERE update_id = $1 AND donor_address = $2",
      [req.params.updateId, donorAddress],
    );

    if (existing.rows[0]) {
      // Unlike
      await pool.query(
        "DELETE FROM update_likes WHERE update_id = $1 AND donor_address = $2",
        [req.params.updateId, donorAddress],
      );
    } else {
      // Like
      await pool.query(
        "INSERT INTO update_likes (id, update_id, donor_address, created_at) VALUES ($1, $2, $3, NOW())",
        [require("uuid").v4(), req.params.updateId, donorAddress],
      );
    }

    // Get updated like count
    const countResult = await pool.query(
      "SELECT COUNT(*) as count FROM update_likes WHERE update_id = $1",
      [req.params.updateId],
    );

    res.json({
      liked: !existing.rows[0],
      likeCount: parseInt(countResult.rows[0].count),
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/updates/:updateId/likes — get like count and user's like status
router.get("/:updateId/likes", async (req, res, next) => {
  try {
    const { donorAddress } = req.query;
    const countResult = await pool.query(
      "SELECT COUNT(*) as count FROM update_likes WHERE update_id = $1",
      [req.params.updateId],
    );
    let liked = false;
    if (donorAddress) {
      const existing = await pool.query(
        "SELECT id FROM update_likes WHERE update_id = $1 AND donor_address = $2",
        [req.params.updateId, donorAddress],
      );
      liked = !!existing.rows[0];
    }
    res.json({
      likeCount: parseInt(countResult.rows[0].count),
      liked,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
