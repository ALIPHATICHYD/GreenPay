# Pull Request: Standardize List Endpoints with Keyset Pagination & Opaque Versioned Cursors

## Summary

This PR replaces offset-based pagination (`LIMIT` / `OFFSET`) across all backend list endpoints with **keyset pagination** (cursor-based pagination) over guaranteed total orderings.

### Problem Addressed
- **Row Shifting & Duplication**: Under high donation activity, inserting or deleting records mid-pagination shifts offset boundaries, causing clients to see duplicate entries or miss newly inserted rows.
- **Deep Offset Performance Penalty**: Deep offset queries force PostgreSQL to perform $O(N)$ row scans and discard skipped records.
- **Non-deterministic Ordering**: Queries missing unique tiebreakers produced non-deterministic results between requests.

---

## Key Changes

1. **Opaque & Versioned Cursors (`backend/src/utils/pagination.js`)**
   - Implemented `v1.<base64url_json>` cursor encoding/decoding.
   - Handled invalid/malformed cursors with HTTP `400 Bad Request` (`INVALID_CURSOR`) and unsupported version strings (`UNSUPPORTED_CURSOR_VERSION`).
   - Maintained backward compatibility for legacy ISO timestamp strings ($v0$) and optional `offset` fallbacks during migration.

2. **Guaranteed Total Ordering & Keyset Queries**
   - Updated queries across list endpoints to include unique primary tiebreakers:
     - `GET /api/projects`: `ORDER BY created_at DESC, id DESC`
     - `GET /api/donations/project/:id`: `ORDER BY created_at DESC, id DESC`
     - `GET /api/donations/project/:id/messages`: `ORDER BY amount DESC, created_at DESC, id DESC`
     - `GET /api/donations/donor/:key`: `ORDER BY created_at DESC, id DESC`
     - `GET /api/leaderboard`: `ORDER BY total_donated_xlm DESC, public_key ASC` with global rank CTE
     - `GET /api/admin/audit`: `ORDER BY created_at DESC, id DESC`
     - `GET /api/admin/ai-summary-failures`: `ORDER BY created_at DESC, id DESC`
     - `GET /api/jobs`: `ORDER BY created_at DESC, id DESC`
     - `GET /api/updates/:projectId`: `ORDER BY created_at DESC, id DESC`
     - `GET /api/notifications/follows`: `ORDER BY created_at DESC, project_id DESC`

3. **Composite Database Indexes (`backend/src/db/schema.sql`)**
   - Added compound indexes to support tuple comparisons:
     - `idx_projects_created_at_id`
     - `idx_donations_project_created_id`
     - `idx_donations_project_amount_created_id`
     - `idx_donations_donor_created_id`
     - `idx_donor_stats_total_public_key`
     - `idx_profiles_total_public_key`
     - `idx_admin_audit_log_created_at_id`
     - `idx_ai_summary_job_failures_created_at_id`
     - `idx_jobs_created_at_id`
     - `idx_project_updates_project_created_id`
     - `idx_project_follows_device_created_project`

4. **Frontend Integration & Documentation**
   - Updated `LeaderboardTable` and `frontend/lib/api.ts` to use continuation-based navigation (`nextCursor`, `hasMore`).
   - Documented the architecture in `docs/pagination.md`.
   - Updated `docs/openapi.yml` with reusable `Pagination` schema, `cursorParam`, and `limitParam`.

---

## Verification & Testing

- **Mutation Safety Test (`backend/src/routes/pagination.integration.test.js`)**:
  - Inserted and deleted rows mid-pagination across page fetches.
  - Asserted zero duplicate rows and zero skipped rows.
- **Latency Benchmark (`backend/src/routes/pagination.integration.test.js`)**:
  - Measured Page 1 vs Deep Page (row 400+) latency under keyset pagination, confirming $O(1)$ index lookup.
- **Suite Results**:
  - Backend: All 46 test suites passed (378 tests).
  - Frontend: All 16 test suites passed (174 tests).
