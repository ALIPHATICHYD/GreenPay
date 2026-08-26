/**
 * src/routes/projects.js
 */
"use strict";
const crypto = require("crypto");
const express = require("express");
const router = express.Router();
const { v4: uuid } = require("uuid");
const pool = require("../db/pool");
const { adminRequired } = require("../middleware/auth");
const { createLayeredRateLimiter } = require("../middleware/rateLimiter");
const { logAdminAction } = require("../services/audit");
const { mapProjectRow, mapProjectMilestoneRow } = require("../services/store");
const { getOnChainProject, CONTRACT_ID, server, NETWORK_PASSPHRASE } = require("../services/stellar");
const { enqueueAISummary } = require("../services/summaryQueue");
const { Contract, TransactionBuilder } = require("@stellar/stellar-sdk");
const { validate } = require("../middleware/validate");
const { createApiError } = require("../middleware/apiEnvelope");
const { ProjectStatusUpdateSchema } = require("../schemas/projects");
const {
  TRANSLATION_STATUSES,
  requireContentLanguage,
  projectLocalizationSelect,
} = require("../services/contentLanguage");

// Layered rate limiters — see middleware/rateLimiter.js for the dimensions.
// Every project mutation is wallet-identity-tied (adminAddress / matcherAddress)
// or authenticated, so IP alone is never the only thing constraining it.

// Generic admin project writes (campaigns, milestones, matches): a coarse
// per-IP floor plus a per-wallet cap keyed on the acting admin/matcher address.
const projectMutationLimiter = createLayeredRateLimiter({
  name: "project-mutation",
  windowMinutes: 1,
  ip: 60,
  wallet: 20,
});

// On-chain admin ops (register / confirm) hit Horizon RPC per call.
const onChainAdminLimiter = createLayeredRateLimiter({
  name: "project-onchain-admin",
  windowMinutes: 1,
  ip: 30,
  wallet: 10,
});

// AI summary generation spends paid Anthropic API credits, so it gets the
// tightest treatment: an IP floor, a per-wallet cap on the project owner, and
// a global cap that no distributed client (each under its own limits) can
// exceed — the expensive-endpoint backpressure the audit called for.
const aiSummaryLimiter = createLayeredRateLimiter({
  name: "project-summary",
  windowMinutes: 1,
  ip: 10,
  wallet: 2,
  global: 20,
});

// Authenticated platform-admin status changes: per-subject cap keyed on the
// verified JWT subject (set by adminRequired), not on any client-supplied
// address.
const statusLimiter = createLayeredRateLimiter({
  name: "project-status",
  windowMinutes: 1,
  ip: 30,
  subject: 10,
});

const VALID_STATUSES = ["active", "completed", "paused"];
const VALID_CATEGORIES = [
  "Reforestation",
  "Solar Energy",
  "Ocean Conservation",
  "Clean Water",
  "Wildlife Protection",
  "Carbon Capture",
  "Wind Energy",
  "Sustainable Agriculture",
  "Other",
];

/**
 * GET /api/projects/featured
 * Returns the project with the highest donorCount (active projects only).
 * Result is cached in memory for 24 hours.
 */
const featuredCache = new Map();

function requestedLanguage(req) {
  if (req.query.lang === undefined) return null;
  return requireContentLanguage(req.query.lang);
}

function validateTranslatedProject(body) {
  const fields = ["name", "description", "category", "location"];
  const result = {};
  for (const field of fields) {
    if (typeof body?.[field] !== "string" || !body[field].trim()) {
      throw createApiError(400, "TRANSLATION_FIELD_REQUIRED", `${field} is required`);
    }
    result[field] = body[field].trim();
  }
  result.machineTranslated = body.machineTranslated === true;
  return result;
}

function mapCampaignRow(row) {
  const now = Date.now();
  const goalXLM = Number.parseFloat(row.goal_xlm?.toString() || "0");
  const raisedXLM = Number.parseFloat(row.raised_xlm?.toString() || "0");
  const deadlineMs = new Date(row.deadline).getTime();
  const completed = raisedXLM >= goalXLM || now >= deadlineMs;
  const progressPercent = goalXLM > 0 ? Math.min(Math.round((raisedXLM / goalXLM) * 100), 100) : 0;

  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description || "",
    goalXLM: row.goal_xlm?.toString() || "0",
    raisedXLM: raisedXLM.toFixed(7),
    deadline: new Date(row.deadline).toISOString(),
    progressPercent,
    completed,
    active: !completed,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

async function fetchCampaignsForProject(projectId) {
  const result = await pool.query(
    `SELECT c.*,
            COALESCE(
              SUM(
                CASE
                  WHEN d.currency = 'XLM' THEN d.amount_xlm
                  ELSE 0
                END
              ),
              0
            ) AS raised_xlm
     FROM project_campaigns c
     LEFT JOIN donations d
       ON d.project_id = c.project_id
      AND d.created_at >= c.created_at
      AND d.created_at <= c.deadline
     WHERE c.project_id = $1
     GROUP BY c.id
     ORDER BY c.created_at DESC`,
    [projectId],
  );
  return result.rows.map(mapCampaignRow);
}

router.get("/featured", async (req, res, next) => {
  try {
    const language = requestedLanguage(req);
    const cacheKey = language || "source";
    const now = Date.now();
    const cached = featuredCache.get(cacheKey);
    if (cached && now < cached.expiresAt) {
      return res.json({ ...cached.project, serverNow: Date.now() });
    }

    const values = [];
    let languageParam = null;
    if (language) {
      values.push(language);
      languageParam = `$${values.length}`;
    }
    const localization = projectLocalizationSelect(languageParam);
    const result = await pool.query(
      `SELECT p.*${localization.columns}${languageParam ? `, ${languageParam}::text AS requested_language` : ""}
       FROM projects p${localization.join}
       WHERE p.status = 'active'
       ORDER BY p.donor_count DESC, p.raised_xlm DESC
       LIMIT 1`,
      values,
    );

    if (!result.rows[0]) {
      throw createApiError(404, "FEATURED_PROJECT_NOT_FOUND", "No featured project found");
    }

    const project = mapProjectRow(result.rows[0]);
    featuredCache.set(cacheKey, { project, expiresAt: now + 24 * 60 * 60 * 1000 });
    res.json({ ...project, serverNow: Date.now() });
  } catch (e) {
    next(e);
  }
});

const { decodeCursor, formatPaginatedResponse } = require("../utils/pagination");

router.get("/", async (req, res, next) => {
  try {
    const { category, status, verified, search, cursor } = req.query;
    const parsedLimit = Math.min(Number.parseInt(req.query.limit, 10) || 50, 100);
    // Validates before any query runs, so an unsupported `lang` is a 400 rather
    // than content silently served under the wrong language label.
    const language = requestedLanguage(req);
    const where = [];
    const values = [];

    if (status && VALID_STATUSES.includes(status)) {
      values.push(status);
      where.push(`p.status = $${values.length}`);
    }
    if (category && VALID_CATEGORIES.includes(category)) {
      values.push(category);
      where.push(`p.category = $${values.length}`);
    }
    if (verified === "true") {
      where.push("p.verified = true");
    }
    if (search && typeof search === "string") {
      values.push(`%${search}%`);
      where.push(`(
        p.name ILIKE $${values.length}
        OR p.description ILIKE $${values.length}
        OR p.location ILIKE $${values.length}
        OR EXISTS (
          SELECT 1
          FROM unnest(p.tags) AS tag
          WHERE tag ILIKE $${values.length}
        )
        OR EXISTS (
          SELECT 1 FROM project_translations search_translation
          WHERE search_translation.project_id = p.id
            AND search_translation.moderation_status = 'approved'
            AND (search_translation.name ILIKE $${values.length}
              OR search_translation.description ILIKE $${values.length}
              OR search_translation.category ILIKE $${values.length}
              OR search_translation.location ILIKE $${values.length})
        )
      )`);
    }

    const cursorObj = decodeCursor(cursor);
    if (cursorObj) {
      if (cursorObj.createdAt && cursorObj.id) {
        values.push(cursorObj.createdAt, cursorObj.id);
        where.push(`(p.created_at, p.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
      } else if (cursorObj.createdAt) {
        values.push(cursorObj.createdAt);
        where.push(`p.created_at < $${values.length}::timestamptz`);
      }
    }

    let languageParam = null;
    if (language) {
      values.push(language);
      languageParam = `$${values.length}`;
    }
    // At most one approved translation per (project, language), so the join
    // cannot fan out rows — which keyset paging relies on, since the page is
    // sized by counting the rows the query returns.
    const localization = projectLocalizationSelect(languageParam);

    values.push(parsedLimit + 1);
    const whereClause = where.length ? `WHERE ${where.join(" AND ")} ` : "";
    const query = `SELECT p.*${localization.columns}${languageParam ? `, ${languageParam}::text AS requested_language` : ""}
      FROM projects p${localization.join} ${whereClause}ORDER BY p.created_at DESC, p.id DESC LIMIT $${values.length}`;

    const result = await pool.query(query, values);
    const { data, meta } = formatPaginatedResponse({
      rows: result.rows,
      limit: parsedLimit,
      getCursorPayload: (row) => ({ createdAt: row.created_at, id: row.id }),
    });

    res.apiMeta(meta);
    res.json(data.map(row => ({ ...mapProjectRow(row), serverNow: Date.now() })));
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/projects/:id/verify
 * Reads the project record directly from the Soroban contract.
 */
router.get("/:id/verify", async (req, res) => {
  try {
    const projectId = req.params.id;
    const onChainProject = await getOnChainProject(projectId);

    const stroopsToXlm = (stroops) => {
      if (stroops === null || stroops === undefined) return "0.0000000";
      let value;
      try {
        value = typeof stroops === "bigint" ? stroops : BigInt(stroops);
      } catch {
        return "0.0000000";
      }
      const negative = value < 0n;
      if (negative) value = -value;
      const whole = value / 10000000n;
      const frac = value % 10000000n;
      const fracStr = frac.toString().padStart(7, "0");
      return `${negative ? "-" : ""}${whole.toString()}.${fracStr}`;
    };

    res.json({
      projectId,
      onChainVerified: Boolean(onChainProject),
      contractRegisteredAt: onChainProject ? Number(onChainProject.registered_at) : null,
      totalRaisedOnChain: onChainProject ? stroopsToXlm(onChainProject.total_raised) : "0.0000000",
    });
  } catch (err) {
    res.json({
      projectId: req.params.id,
      onChainVerified: false,
      contractRegisteredAt: null,
      totalRaisedOnChain: "0.0000000",
    });
  }
});

router.post("/:id/campaigns", projectMutationLimiter, async (req, res, next) => {
  try {
    const { title, goalXLM, deadline, description } = req.body || {};
    const trimmedTitle = typeof title === "string" ? title.trim() : "";
    const trimmedDescription = typeof description === "string" ? description.trim() : "";
    const goal = Number.parseFloat(goalXLM);
    const deadlineDate = new Date(deadline);

    if (trimmedTitle.length < 3 || trimmedTitle.length > 120) {
      throw createApiError(400, "TITLE_LENGTH_INVALID", "title must be between 3 and 120 characters");
    }
    if (!Number.isFinite(goal) || goal <= 0) {
      throw createApiError(400, "GOAL_XLM_INVALID", "goalXLM must be a positive number");
    }
    if (!deadline || Number.isNaN(deadlineDate.getTime())) {
      throw createApiError(400, "DEADLINE_INVALID", "deadline must be a valid ISO date string");
    }
    if (deadlineDate.getTime() <= Date.now()) {
      throw createApiError(400, "DEADLINE_NOT_FUTURE", "deadline must be in the future");
    }
    if (trimmedDescription.length > 500) {
      throw createApiError(400, "DESCRIPTION_TOO_LONG", "description must be 500 characters or fewer");
    }

    const projectResult = await pool.query("SELECT id FROM projects WHERE id = $1", [req.params.id]);
    if (!projectResult.rows[0]) {
      throw createApiError(404, "PROJECT_NOT_FOUND", "Project not found");
    }

    const result = await pool.query(
      `INSERT INTO project_campaigns (id, project_id, title, description, goal_xlm, deadline, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING *, 0::numeric AS raised_xlm`,
      [uuid(), req.params.id, trimmedTitle, trimmedDescription || null, goal.toFixed(7), deadlineDate.toISOString()],
    );

    logAdminAction({
      actor: req.body?.adminAddress || "unknown",
      action: "project.campaign.create",
      targetType: "project_campaign",
      targetId: result.rows[0].id,
      metadata: { projectId: req.params.id, title: trimmedTitle, goalXLM: goal, deadline },
      ipAddress: req.ip,
    });

    res.status(201).json(mapCampaignRow(result.rows[0]));
  } catch (e) {
    next(e);
  }
});

router.get("/:id/campaigns", async (req, res, next) => {
  try {
    const projectResult = await pool.query("SELECT id FROM projects WHERE id = $1", [req.params.id]);
    if (!projectResult.rows[0]) {
      throw createApiError(404, "PROJECT_NOT_FOUND", "Project not found");
    }
    const campaigns = await fetchCampaignsForProject(req.params.id);
    res.json(campaigns);
  } catch (e) {
    next(e);
  }
});

router.get("/:id/milestones", async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT * FROM project_milestones WHERE project_id = $1 ORDER BY percentage ASC",
      [req.params.id],
    );
    res.json(result.rows.map(mapProjectMilestoneRow));
  } catch (e) {
    next(e);
  }
});

router.post("/:id/milestones", projectMutationLimiter, async (req, res, next) => {
  try {
    const { title, percentage } = req.body;
    if (!title || typeof percentage !== "number") {
      throw createApiError(400, "MILESTONE_FIELDS_REQUIRED", "title and percentage (number) are required");
    }
    const result = await pool.query(
      `INSERT INTO project_milestones (id, project_id, title, percentage)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [uuid(), req.params.id, title, percentage],
    );

    logAdminAction({
      actor: req.body?.adminAddress || "unknown",
      action: "project.milestone.create",
      targetType: "project_milestone",
      targetId: result.rows[0].id,
      metadata: { projectId: req.params.id, title, percentage },
      ipAddress: req.ip,
    });

    res.status(201).json(mapProjectMilestoneRow(result.rows[0]));
  } catch (e) {
    next(e);
  }
});

router.post("/:id/milestones/:milestoneId/reach", projectMutationLimiter, async (req, res, next) => {
  try {
    const { transactionHash } = req.body;
    const result = await pool.query(
      `UPDATE project_milestones
       SET reached_at = NOW(), transaction_hash = $1
       WHERE id = $2 AND project_id = $3
       RETURNING *`,
      [transactionHash || null, req.params.milestoneId, req.params.id],
    );
    if (!result.rows[0]) {
      throw createApiError(404, "MILESTONE_NOT_FOUND", "Milestone not found");
    }

    logAdminAction({
      actor: req.body?.adminAddress || "unknown",
      action: "project.milestone.reach",
      targetType: "project_milestone",
      targetId: req.params.milestoneId,
      metadata: { projectId: req.params.id, transactionHash },
      ipAddress: req.ip,
    });

    res.json(mapProjectMilestoneRow(result.rows[0]));
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/projects/admin/register
 * Builds a Soroban transaction to register a project on-chain.
 * Returns the XDR for the admin to sign.
 */
router.post("/admin/register", onChainAdminLimiter, async (req, res, next) => {
  try {
    const { projectId, name, wallet, co2PerXLM, adminAddress } = req.body;
    
    if (!CONTRACT_ID) {
      throw createApiError(503, "CONTRACT_NOT_CONFIGURED", "CONTRACT_ID not configured");
    }
    if (!adminAddress) {
      throw createApiError(400, "ADMIN_ADDRESS_REQUIRED", "adminAddress is required");
    }

    const contract = new Contract(CONTRACT_ID);
    const sourceAccount = await server.loadAccount(adminAddress);

    const tx = new TransactionBuilder(sourceAccount, { 
      fee: "1000", 
      networkPassphrase: NETWORK_PASSPHRASE 
    })
      .addOperation(contract.call("register_project", adminAddress, projectId, name, wallet, parseInt(co2PerXLM)))
      .setTimeout(30)
      .build();

    logAdminAction({
      actor: adminAddress,
      action: "project.register",
      targetType: "project",
      targetId: projectId,
      metadata: { name, wallet, co2PerXLM },
      ipAddress: req.ip,
    });

    res.json({ xdr: tx.toXDR() });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/projects/admin/confirm
 * Verifies a registration transaction and updates the local store.
 */
router.post("/admin/confirm", onChainAdminLimiter, async (req, res, next) => {
  try {
    const { transactionHash, projectId } = req.body;
    
    const tx = await server.getTransaction(transactionHash);
    if (!tx.successful) {
      throw createApiError(400, "TRANSACTION_FAILED", "Transaction failed");
    }

    const result = await pool.query(
      `UPDATE projects
       SET on_chain_verified = true,
           verified = true,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [projectId],
    );

    logAdminAction({
      actor: "admin",
      action: "project.confirm",
      targetType: "project",
      targetId: projectId,
      metadata: { transactionHash },
      ipAddress: req.ip,
    });

    res.json(result.rows[0] ? mapProjectRow(result.rows[0]) : null);
  } catch (err) {
    next(err);
  }
});

router.put("/:id/translations/:language", adminRequired, projectMutationLimiter, async (req, res, next) => {
  try {
    const language = requireContentLanguage(req.params.language);
    const translated = validateTranslatedProject(req.body);
    const projectResult = await pool.query("SELECT id, source_language FROM projects WHERE id = $1", [req.params.id]);
    if (!projectResult.rows[0]) {
      throw createApiError(404, "PROJECT_NOT_FOUND", "Project not found");
    }
    if (language === projectResult.rows[0].source_language) {
      throw createApiError(409, "SOURCE_LANGUAGE_TRANSLATION", "A translation cannot replace the original language");
    }
    const result = await pool.query(
      `INSERT INTO project_translations
        (id, project_id, language, name, description, category, location, machine_translated, moderation_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
       ON CONFLICT (project_id, language) DO UPDATE SET
         name = EXCLUDED.name, description = EXCLUDED.description,
         category = EXCLUDED.category, location = EXCLUDED.location,
         machine_translated = EXCLUDED.machine_translated,
         impact_claims_reviewed = FALSE, moderation_status = 'pending', updated_at = NOW()
       RETURNING *`,
      [uuid(), req.params.id, language, translated.name, translated.description,
        translated.category, translated.location, translated.machineTranslated],
    );
    featuredCache.clear();
    logAdminAction({
      actor: req.admin.sub,
      action: "project.translation.submitted",
      targetType: "project_translation",
      targetId: result.rows[0].id,
      metadata: { projectId: req.params.id, language },
      ipAddress: req.ip,
    });
    res.status(201).json(result.rows[0]);
  } catch (e) {
    next(e);
  }
});

router.patch("/:id/translations/:language/moderation", adminRequired, statusLimiter, async (req, res, next) => {
  try {
    const language = requireContentLanguage(req.params.language);
    const { status, impactClaimsReviewed = false } = req.body || {};
    if (!TRANSLATION_STATUSES.includes(status)) {
      throw createApiError(400, "TRANSLATION_STATUS_INVALID", `status must be one of: ${TRANSLATION_STATUSES.join(", ")}`);
    }
    const existing = await pool.query(
      "SELECT * FROM project_translations WHERE project_id = $1 AND language = $2",
      [req.params.id, language],
    );
    if (!existing.rows[0]) {
      throw createApiError(404, "PROJECT_TRANSLATION_NOT_FOUND", "Project translation not found");
    }
    if (status === "approved" && existing.rows[0].machine_translated && impactClaimsReviewed !== true) {
      throw createApiError(400, "IMPACT_CLAIMS_REVIEW_REQUIRED", "Machine-translated impact claims require human review before approval");
    }
    const result = await pool.query(
      `UPDATE project_translations SET moderation_status = $1,
         impact_claims_reviewed = $2, updated_at = NOW()
       WHERE project_id = $3 AND language = $4 RETURNING *`,
      [status, impactClaimsReviewed === true, req.params.id, language],
    );
    featuredCache.clear();
    logAdminAction({
      actor: req.admin.sub,
      action: `project.translation.${status}`,
      targetType: "project_translation",
      targetId: result.rows[0].id,
      metadata: { projectId: req.params.id, language, impactClaimsReviewed: impactClaimsReviewed === true },
      ipAddress: req.ip,
    });
    res.json(result.rows[0]);
  } catch (e) {
    next(e);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const language = requestedLanguage(req);
    const values = [req.params.id];
    let languageParam = null;
    if (language) {
      values.push(language);
      languageParam = `$${values.length}`;
    }
    const localization = projectLocalizationSelect(languageParam);
    const projectResult = await pool.query(
      `SELECT p.*${localization.columns}${languageParam ? `, ${languageParam}::text AS requested_language` : ""}
       FROM projects p${localization.join} WHERE p.id = $1`,
      values,
    );
    if (!projectResult.rows[0]) {
      throw createApiError(404, "PROJECT_NOT_FOUND", "Project not found");
    }
    const campaigns = await fetchCampaignsForProject(req.params.id);
    const onChainProject = await getOnChainProject(req.params.id);

    // Fetch average rating
    const ratingResult = await pool.query(
      "SELECT AVG(rating) as avg_rating, COUNT(*) as count FROM project_ratings WHERE project_id = $1",
      [req.params.id],
    );

    // Fetch milestones
    const milestoneResult = await pool.query(
      "SELECT * FROM project_milestones WHERE project_id = $1 ORDER BY percentage ASC",
      [req.params.id],
    );

    const stroopsToXlm = (stroops) => {
      if (stroops === null || stroops === undefined) return "0.0000000";
      let value;
      try {
        value = typeof stroops === "bigint" ? stroops : BigInt(stroops);
      } catch {
        return "0.0000000";
      }
      const negative = value < 0n;
      if (negative) value = -value;
      const whole = value / 10000000n;
      const frac = value % 10000000n;
      const fracStr = frac.toString().padStart(7, "0");
      return `${negative ? "-" : ""}${whole.toString()}.${fracStr}`;
    };

    res.json({
      ...mapProjectRow(projectResult.rows[0]),
      serverNow: Date.now(),
      onChainVerified: Boolean(onChainProject) || Boolean(projectResult.rows[0].on_chain_verified),
      contractRegisteredAt: onChainProject ? Number(onChainProject.registered_at) : null,
      totalRaisedOnChain: onChainProject ? stroopsToXlm(onChainProject.total_raised) : "0.0000000",
      campaigns,
      activeCampaign: campaigns.find((campaign) => campaign.active) || null,
      averageRating: parseFloat(ratingResult.rows[0].avg_rating) || 0,
      ratingCount: parseInt(ratingResult.rows[0].count) || 0,
      milestones: milestoneResult.rows.map(mapProjectMilestoneRow),
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/projects/:id/generate-summary
 *
 * Generates (or regenerates) a 3-sentence donor-facing impact summary using
 * the Claude API and caches it on the project record. Body:
 *
 *   { adminAddress: "G..." }   // must equal projects.wallet_address
 *
 * Mirrors the admin-page convention (`isOwner = publicKey === walletAddress`)
 * so only the project owner can spend Anthropic API credits on their project.
 *
 * Response data: { aiSummary, aiSummaryGeneratedAt, aiSummaryModel,
 *                  aiSummarySourceHash }
 */
router.post("/:id/generate-summary", aiSummaryLimiter, async (req, res, next) => {
  try {
    const { adminAddress } = req.body || {};
    if (!adminAddress || typeof adminAddress !== "string") {
      throw createApiError(400, "ADMIN_ADDRESS_REQUIRED", "adminAddress is required");
    }

    const projectResult = await pool.query(
      "SELECT id, name, category, description, wallet_address FROM projects WHERE id = $1",
      [req.params.id],
    );
    const project = projectResult.rows[0];
    if (!project) {
      throw createApiError(404, "PROJECT_NOT_FOUND", "Project not found");
    }
    if (project.wallet_address !== adminAddress) {
      throw createApiError(403, "PROJECT_OWNER_REQUIRED", "Only the project owner can generate a summary");
    }

    await enqueueAISummary(req.params.id, {
      name: project.name,
      category: project.category,
      description: project.description,
      adminAddress,
    });

    logAdminAction({
      actor: adminAddress,
      action: "project.summary.enqueued",
      targetType: "project",
      targetId: req.params.id,
      metadata: {},
      ipAddress: req.ip,
    });

    res.status(202).json({ status: "queued" });
  } catch (e) {
    next(e);
  }
});

router.post("/:id/matching", projectMutationLimiter, async (req, res, next) => {
  try {
    const { matcherAddress, capXLM, multiplier, expiresAt } = req.body || {};

    if (!matcherAddress || typeof matcherAddress !== "string") {
      throw createApiError(400, "MATCHER_ADDRESS_REQUIRED", "matcherAddress is required");
    }
    if (!capXLM || isNaN(Number.parseFloat(capXLM)) || Number.parseFloat(capXLM) <= 0) {
      throw createApiError(400, "CAP_XLM_INVALID", "capXLM must be a positive number");
    }
    if (!multiplier || typeof multiplier !== "number" || multiplier < 1) {
      throw createApiError(400, "MULTIPLIER_INVALID", "multiplier must be >= 1");
    }
    if (!expiresAt || Number.isNaN(new Date(expiresAt).getTime())) {
      throw createApiError(400, "EXPIRES_AT_INVALID", "expiresAt must be a valid ISO date string");
    }
    if (new Date(expiresAt).getTime() <= Date.now()) {
      throw createApiError(400, "EXPIRES_AT_NOT_FUTURE", "expiresAt must be in the future");
    }

    const projectResult = await pool.query("SELECT id FROM projects WHERE id = $1", [req.params.id]);
    if (!projectResult.rows[0]) {
      throw createApiError(404, "PROJECT_NOT_FOUND", "Project not found");
    }

    const result = await pool.query(
      `INSERT INTO donation_matches (id, project_id, matcher_address, cap_xlm, multiplier, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, project_id, matcher_address, cap_xlm, multiplier, matched_xlm, expires_at, created_at`,
      [uuid(), req.params.id, matcherAddress, Number.parseFloat(capXLM).toFixed(7), multiplier, new Date(expiresAt).toISOString()],
    );

    logAdminAction({
      actor: matcherAddress,
      action: "project.matching.create",
      targetType: "donation_match",
      targetId: result.rows[0].id,
      metadata: { projectId: req.params.id, capXLM, multiplier, expiresAt },
      ipAddress: req.ip,
    });

    const row = result.rows[0];
    res.status(201).json({
      id: row.id,
      projectId: row.project_id,
      matcherAddress: row.matcher_address,
      capXLM: row.cap_xlm?.toString() || "0",
      multiplier: row.multiplier,
      matchedXLM: row.matched_xlm?.toString() || "0",
      expiresAt: new Date(row.expires_at).toISOString(),
      createdAt: new Date(row.created_at).toISOString(),
    });
  } catch (e) {
    next(e);
  }
});

router.get("/:id/matching", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, project_id, matcher_address, cap_xlm, multiplier, matched_xlm, expires_at, created_at
       FROM donation_matches
       WHERE project_id = $1 AND expires_at > NOW()
       ORDER BY created_at DESC`,
      [req.params.id],
    );

    const matches = result.rows.map(row => ({
      id: row.id,
      projectId: row.project_id,
      matcherAddress: row.matcher_address,
      capXLM: row.cap_xlm?.toString() || "0",
      multiplier: row.multiplier,
      matchedXLM: row.matched_xlm?.toString() || "0",
      remainingXLM: (Number.parseFloat(row.cap_xlm) - Number.parseFloat(row.matched_xlm)).toFixed(7),
      expiresAt: new Date(row.expires_at).toISOString(),
      createdAt: new Date(row.created_at).toISOString(),
    }));

    res.json(matches);
  } catch (e) {
    next(e);
  }
});

/**
 * PATCH /api/projects/:id/status
 * Approve or reject a project. Body: { status: "active" | "rejected", reason?: string }
 * Requires a verified platform-admin JWT (adminRequired) — no client-supplied
 * identity claim is accepted as proof for this action.
 */
router.patch(
  "/:id/status",
  // adminRequired runs before validate so an unauthenticated caller is turned
  // away with a 401 rather than being told, via a 400, whether their body was
  // well-formed. It also sets req.admin so the subject-keyed limiter can
  // constrain the authenticated identity regardless of source address.
  adminRequired,
  statusLimiter,
  validate(ProjectStatusUpdateSchema),
  async (req, res, next) => {
    try {
      const { status, reason } = req.body;

      const projectResult = await pool.query("SELECT * FROM projects WHERE id = $1", [req.params.id]);
      if (!projectResult.rows[0]) {
        throw createApiError(404, "PROJECT_NOT_FOUND", "Project not found");
      }

      const result = await pool.query(
        `UPDATE projects
       SET status = $1,
           rejection_reason = $2,
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
        [status, reason || null, req.params.id],
      );

      logAdminAction({
        // The verified JWT subject, never a client-supplied adminAddress: the
        // request body is attacker-controlled, so trusting it here would let
        // anyone forge who an audited status change is attributed to.
        actor: req.admin.sub,
        action: `project.status.${status}`,
        targetType: "project",
        targetId: req.params.id,
        metadata: { previousStatus: projectResult.rows[0].status, reason },
        ipAddress: req.ip,
      });

      res.json(mapProjectRow(result.rows[0]));
    } catch (e) {
      next(e);
    }
  });

module.exports = router;
