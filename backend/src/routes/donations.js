/**
 * src/routes/donations.js
 */
"use strict";
const express = require("express");
const router  = express.Router();
const { v4: uuid } = require("uuid");
const pool = require("../db/pool");
const { createRateLimiter } = require("../middleware/rateLimiter");
const { computeBadges, mapDonationRow } = require("../services/store");
const donationLimiter = createRateLimiter(10, 1); // 10 requests per minute

function validateKey(k) {
  if (!k || !/^G[A-Z0-9]{55}$/.test(k)) { const e = new Error("Invalid Stellar public key"); e.status = 400; throw e; }
}

function validateTxHash(h) {
  if (!h || !/^[a-fA-F0-9]{64}$/.test(h)) { const e = new Error("Invalid transaction hash"); e.status = 400; throw e; }
}

// POST /api/donations — record a donation after on-chain tx
async function recordDonation(req, res, next) {
  let client;
  let inTransaction = false;

  try {
    const { projectId, donorAddress, amountXLM, amount, currency = "XLM", message, transactionHash } = req.body;
    const idempotencyKey = (req.body.idempotencyKey || transactionHash).trim();
    if (!idempotencyKey || idempotencyKey.length > 128) { const e = new Error("Invalid idempotency key"); e.status = 400; throw e; }
    validateKey(donorAddress);
    validateTxHash(transactionHash);

    client = await pool.connect();

    // Determine numeric amount depending on currency
    const parsedAmount = parseFloat(currency === "XLM" ? amountXLM ?? amount : amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) { const e = new Error("Invalid amount"); e.status = 400; throw e; }

    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    inTransaction = true;

    const projectResult = await client.query("SELECT id FROM projects WHERE id = $1 FOR UPDATE", [projectId]);
    if (!projectResult.rows[0]) { const e = new Error("Project not found"); e.status = 404; throw e; }

    const donationResult = await client.query(
      `INSERT INTO donations (
        id, project_id, donor_address, amount_xlm, amount, currency, message, transaction_hash, idempotency_key, status, saga_step, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'prepared', 'donation_recorded', NOW(), NOW())
      ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
      RETURNING *, (xmax = 0) AS inserted`,
      [
        uuid(),
        projectId,
        donorAddress,
        currency === "XLM" ? parsedAmount : null,
        parsedAmount,
        currency,
        message?.trim().slice(0, 100) || null,
        transactionHash,
        idempotencyKey,
      ],
    );

    const donation = donationResult.rows[0];
    if (!donation.inserted) {
      await client.query("COMMIT");
      inTransaction = false;
      return res.json({ success: true, data: mapDonationRow(donation) });
    }

    // Check for active matching offers
    if (currency === "XLM") {
      const matchesResult = await client.query(
        `SELECT id, matcher_address, cap_xlm, matched_xlm, multiplier
         FROM donation_matches
         WHERE project_id = $1 AND expires_at > NOW()`,
        [projectId],
      );

      for (const match of matchesResult.rows) {
        const matchedXlm = Number.parseFloat(match.matched_xlm || "0");
        const capXlm = Number.parseFloat(match.cap_xlm);
        const remaining = capXlm - matchedXlm;

        if (remaining > 0) {
          const matchAmount = Math.min(parsedAmount * match.multiplier, remaining);

          await client.query(
            `INSERT INTO donations (
              id, project_id, donor_address, amount_xlm, amount, currency, message, transaction_hash, idempotency_key, status, saga_step, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'committed', 'matching_recorded', NOW(), NOW())
            ON CONFLICT (idempotency_key) DO NOTHING`,
            [
              uuid(),
              projectId,
              match.matcher_address,
              matchAmount,
              matchAmount,
              "XLM",
              `Matching donation for donation from ${donorAddress}`,
              `match-${transactionHash}-${match.id}`,
              `match-${idempotencyKey}-${match.id}`,
            ],
          );

          await client.query(
            `UPDATE donation_matches SET matched_xlm = matched_xlm + $1 WHERE id = $2`,
            [matchAmount, match.id],
          );
        }
      }
    }

    // Update project totals
    await client.query(
      `UPDATE projects
       SET raised_xlm = raised_xlm + $1::numeric,
           donor_count = (
             SELECT COUNT(DISTINCT donor_address)
             FROM donations
             WHERE project_id = $2
           ),
           updated_at = NOW()
       WHERE id = $2`,
      [currency === "XLM" ? parsedAmount : 0, projectId],
    );

    // Update donor profile
    const existingProfileResult = await client.query(
      "SELECT * FROM profiles WHERE public_key = $1 FOR UPDATE",
      [donorAddress],
    );
    const existingProfile = existingProfileResult.rows[0];
    const previousTotal = existingProfile
      ? Number.parseFloat(existingProfile.total_donated_xlm || "0")
      : 0;
    const newTotal = currency === "XLM" ? previousTotal + parsedAmount : previousTotal;
    const projectsSupportedResult = await client.query(
      `SELECT COUNT(DISTINCT project_id) AS count
       FROM donations
       WHERE donor_address = $1`,
      [donorAddress],
    );
    const projectsSupported = Number.parseInt(projectsSupportedResult.rows[0].count, 10) || 0;
    const badges = computeBadges(newTotal);

    await client.query(
      `INSERT INTO profiles (
        public_key, display_name, bio, total_donated_xlm, projects_supported, badges, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW(), NOW())
      ON CONFLICT (public_key) DO UPDATE SET
        total_donated_xlm = EXCLUDED.total_donated_xlm,
        projects_supported = EXCLUDED.projects_supported,
        badges = EXCLUDED.badges,
        updated_at = EXCLUDED.updated_at`,
      [
        donorAddress,
        existingProfile?.display_name || null,
        existingProfile?.bio || null,
        newTotal.toFixed(7),
        projectsSupported,
        JSON.stringify(badges),
      ],
    );

    await client.query(
      "UPDATE donations SET status = $1, saga_step = $2, updated_at = NOW() WHERE id = $3",
      ["committed", "profile_updated", donation.id],
    );

    await client.query("COMMIT");
    inTransaction = false;

    const io = req.app?.get("io");
    if (io) {
      io.emit("donation_event", {
        projectId,
        donorAddress,
        amountXLM: donation.amount_xlm,
        transactionHash,
        timestamp: new Date().toISOString(),
      });
    }

    res.status(201).json({ success: true, data: mapDonationRow({ ...donation, status: "committed", saga_step: "profile_updated" }) });
  } catch (e) {
    if (inTransaction && client) await client.query("ROLLBACK");
    next(e);
  } finally {
    if (client) client.release();
  }
}

router.post("/", donationLimiter, recordDonation);

// GET /api/donations/project/:id
router.get("/project/:projectId/messages", async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const result = await pool.query(
      `SELECT *
       FROM donations
       WHERE project_id = $1
         AND message IS NOT NULL
         AND length(trim(message)) > 0
       ORDER BY amount DESC, created_at DESC
       LIMIT $2`,
      [req.params.projectId, limit],
    );
    res.json({ success: true, data: result.rows.map(mapDonationRow) });
  } catch (e) {
    next(e);
  }
});

router.get("/project/:projectId", async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const hasCursor = Boolean(req.query.cursor);
    const values = hasCursor
      ? [req.params.projectId, req.query.cursor, limit + 1]
      : [req.params.projectId, limit + 1];

    const query = hasCursor
      ? `SELECT * FROM donations
         WHERE project_id = $1
           AND created_at < $2::timestamptz
         ORDER BY created_at DESC
         LIMIT $3`
      : `SELECT * FROM donations
         WHERE project_id = $1
         ORDER BY created_at DESC
         LIMIT $2`;

    const donations = (await pool.query(query, values)).rows.map(mapDonationRow);
    const hasMore = donations.length > limit;
    const result = hasMore ? donations.slice(0, limit) : donations;
    const nextCursor = hasMore ? result[result.length - 1].createdAt : null;

    res.json({ success: true, data: result, nextCursor });
  } catch (e) {
    next(e);
  }
});

// GET /api/donations/donor/:publicKey
router.get("/donor/:publicKey", async (req, res, next) => {
  try {
    validateKey(req.params.publicKey);
    const result = await pool.query(
      `SELECT * FROM donations
       WHERE donor_address = $1
       ORDER BY created_at DESC`,
      [req.params.publicKey],
    );
    res.json({ success: true, data: result.rows.map(mapDonationRow) });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.recordDonation = recordDonation;
