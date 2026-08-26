/**
 * src/routes/leaderboard.js
 */
"use strict";
const express = require("express");
const router  = express.Router();
const pool = require("../db/pool");
const { validate } = require("../middleware/validate");
const { LeaderboardQuerySchema } = require("../schemas/leaderboard");

// period=all reads from donor_stats, the aggregate donation projections.js
// keeps current on every DonationRecorded/MatchApplied/MigratedDonation
// (unlike profiles.total_donated_xlm, which is dead and only ever 0).
const { decodeCursor, formatPaginatedResponse } = require("../utils/pagination");

const ALL_TIME_COUNT_QUERY = "SELECT COUNT(*) AS total FROM donor_stats";
const PERIOD_COUNT_QUERY = "SELECT COUNT(*) AS total FROM profiles";

router.get("/", validate(LeaderboardQuerySchema, { source: "query" }), async (req, res, next) => {
  try {
    const { limit, offset = 0, period, cursor } = req.query;
    const cursorObj = decodeCursor(cursor);
    let useOffset = false;

    const values = [];
    const where = [];

    if (cursorObj && cursorObj.totalDonatedXlm !== undefined && cursorObj.publicKey) {
      values.push(cursorObj.totalDonatedXlm, cursorObj.publicKey);
      where.push(`(total_donated_xlm < $1::numeric OR (total_donated_xlm = $1::numeric AND public_key > $2))`);
    } else if (offset > 0) {
      useOffset = true;
    }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")} ` : "";

    let dataQuery;
    if (period === "all") {
      if (useOffset) {
        values.push(limit + 1, offset);
        dataQuery = `
          WITH ranked AS (
            SELECT ds.public_key, p.display_name, ds.badges,
                   ds.total_donated_xlm, ds.projects_supported,
                   ROW_NUMBER() OVER (ORDER BY ds.total_donated_xlm DESC, ds.public_key ASC) AS rank
            FROM donor_stats ds
            JOIN profiles p ON p.public_key = ds.public_key
          )
          SELECT * FROM ranked
          ORDER BY total_donated_xlm DESC, public_key ASC
          LIMIT $1 OFFSET $2
        `;
      } else {
        values.push(limit + 1);
        dataQuery = `
          WITH ranked AS (
            SELECT ds.public_key, p.display_name, ds.badges,
                   ds.total_donated_xlm, ds.projects_supported,
                   ROW_NUMBER() OVER (ORDER BY ds.total_donated_xlm DESC, ds.public_key ASC) AS rank
            FROM donor_stats ds
            JOIN profiles p ON p.public_key = ds.public_key
          )
          SELECT * FROM ranked
          ${whereClause}ORDER BY total_donated_xlm DESC, public_key ASC
          LIMIT $${values.length}
        `;
      }
    } else {
      const interval = period === "month" ? "30 days" : "1 year";
      if (useOffset) {
        values.push(limit + 1, offset);
        dataQuery = `
          WITH ranked AS (
            SELECT p.public_key, p.display_name, p.badges,
                   COALESCE(SUM(d.amount_xlm), 0)::NUMERIC AS total_donated_xlm,
                   COUNT(DISTINCT d.project_id)::INTEGER AS projects_supported,
                   ROW_NUMBER() OVER (
                     ORDER BY COALESCE(SUM(d.amount_xlm), 0) DESC, p.public_key ASC
                   ) AS rank
            FROM profiles p
            LEFT JOIN donations d
              ON p.public_key = d.donor_address
              AND d.created_at >= NOW() - INTERVAL '${interval}'
            GROUP BY p.public_key, p.display_name, p.badges
          )
          SELECT * FROM ranked
          ORDER BY total_donated_xlm DESC, public_key ASC
          LIMIT $1 OFFSET $2
        `;
      } else {
        values.push(limit + 1);
        dataQuery = `
          WITH ranked AS (
            SELECT p.public_key, p.display_name, p.badges,
                   COALESCE(SUM(d.amount_xlm), 0)::NUMERIC AS total_donated_xlm,
                   COUNT(DISTINCT d.project_id)::INTEGER AS projects_supported,
                   ROW_NUMBER() OVER (
                     ORDER BY COALESCE(SUM(d.amount_xlm), 0) DESC, p.public_key ASC
                   ) AS rank
            FROM profiles p
            LEFT JOIN donations d
              ON p.public_key = d.donor_address
              AND d.created_at >= NOW() - INTERVAL '${interval}'
            GROUP BY p.public_key, p.display_name, p.badges
          )
          SELECT * FROM ranked
          ${whereClause}ORDER BY total_donated_xlm DESC, public_key ASC
          LIMIT $${values.length}
        `;
      }
    }

    const countQuery = period === "all" ? ALL_TIME_COUNT_QUERY : PERIOD_COUNT_QUERY;
    const [result, countResult] = await Promise.all([
      pool.query(dataQuery, values),
      pool.query(countQuery),
    ]);

    const totalCount = parseInt(countResult.rows[0]?.total ?? 0, 10);

    const { data, meta } = formatPaginatedResponse({
      rows: result.rows,
      limit,
      getCursorPayload: (row) => ({
        totalDonatedXlm: row.total_donated_xlm?.toString() || "0",
        publicKey: row.public_key,
      }),
      totalCount,
      isTotalExact: true,
    });

    const entries = data.map((p) => ({
      rank: Number(p.rank),
      publicKey: p.public_key,
      displayName: p.display_name || null,
      totalDonatedXLM: p.total_donated_xlm?.toString() || "0",
      projectsSupported: p.projects_supported,
      topBadge: p.badges?.[0]?.tier || null,
    }));

    res.apiMeta({
      ...meta,
      pagination: {
        ...meta.pagination,
        total: totalCount,
        offset,
      },
    });
    res.json(entries);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
