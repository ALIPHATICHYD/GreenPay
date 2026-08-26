# Keyset Pagination Architecture & Specification

## Overview
All paginated list endpoints across the GreenPay platform use **keyset pagination** (cursor-based pagination) over a guaranteed total ordering. Offset-based pagination (`LIMIT` / `OFFSET`) is deprecated because:
1. Concurrent insertions/deletions mid-pagination cause skipped or duplicated rows for active clients.
2. Deep offsets suffer `O(N)` performance degradation as PostgreSQL must scan and discard all skipped rows.

---

## Cursor Specification

### 1. Opaque & Versioned Format
Cursors are opaque base64url strings prefixed with a version identifier:
```
v1.<base64url_json>
```

#### Example:
- **Decoded Payload**:
  ```json
  {
    "createdAt": "2026-08-26T12:00:00.000Z",
    "id": "11111111-1111-1111-1111-111111111111"
  }
  ```
- **Encoded Cursor**:
  `v1.eyJjcmVhdGVkQXQiOiIyMDI2LTA4LTI2VDEyOjAwOjAwWiIsImlkIjoiMTExMTExMTEtMTExMS0xMTExLTExMTEtMTExMTExMTExMTExIn0`

### 2. Backward Compatibility & Error Handling
- **Invalid Cursors**: Requests with malformed base64url data, non-object JSON, or invalid syntax fail with HTTP `400 Bad Request` and machine-readable error code `INVALID_CURSOR`.
- **Unsupported Versions**: Cursors with unsupported version prefixes (e.g., `v2.xxx`) fail with HTTP `400 Bad Request` and machine-readable error code `UNSUPPORTED_CURSOR_VERSION`.
- **Legacy ISO Strings**: For backward compatibility during migration, plain ISO 8601 timestamp strings (e.g. `2026-08-26T12:00:00.000Z`) are accepted as legacy (`v0`) timestamp cursors.

---

## Total Ordering Guarantees

Every paginated SQL query includes primary sort columns **plus a unique tiebreaker column** to enforce total ordering:

| Endpoint | Primary Sort Field(s) | Unique Tiebreaker Field | Keyset Filter Clause |
| :--- | :--- | :--- | :--- |
| `GET /api/projects` | `created_at DESC` | `id DESC` | `(created_at, id) < ($createdAt, $id)` |
| `GET /api/donations/project/:id` | `created_at DESC` | `id DESC` | `(created_at, id) < ($createdAt, $id)` |
| `GET /api/donations/project/:id/messages` | `amount DESC, created_at DESC` | `id DESC` | `amount < $amt OR (amount = $amt AND (created_at, id) < ($time, $id))` |
| `GET /api/donations/donor/:key` | `created_at DESC` | `id DESC` | `(created_at, id) < ($createdAt, $id)` |
| `GET /api/leaderboard` | `total_donated_xlm DESC` | `public_key ASC` | `total_donated_xlm < $total OR (total_donated_xlm = $total AND public_key > $pk)` |
| `GET /api/admin/audit` | `created_at DESC` | `id DESC` | `(created_at, id) < ($createdAt, $id)` |
| `GET /api/admin/ai-summary-failures` | `created_at DESC` | `id DESC` | `(created_at, id) < ($createdAt, $id)` |
| `GET /api/jobs` | `created_at DESC` | `id DESC` | `(created_at, id) < ($createdAt, $id)` |
| `GET /api/updates/:projectId` | `created_at DESC` | `id DESC` | `(created_at, id) < ($createdAt, $id)` |
| `GET /api/notifications/follows` | `created_at DESC` | `project_id DESC` | `(created_at, project_id) < ($createdAt, $projectId)` |

---

## Standardized Response Metadata

Successful paginated requests return metadata in `meta.pagination`:

```json
{
  "success": true,
  "data": [ ... ],
  "meta": {
    "nextCursor": "v1.eyJjcmVhdGVkQXQiOiIyMDI2LTA4LTI2VDEyOjAwOjAwWiIsImlkIjoiYWJjZCJ9",
    "hasMore": true,
    "pagination": {
      "nextCursor": "v1.eyJjcmVhdGVkQXQiOiIyMDI2LTA4LTI2VDEyOjAwOjAwWiIsImlkIjoiYWJjZCJ9",
      "hasMore": true,
      "limit": 20,
      "totalCount": 142,
      "isTotalExact": true
    }
  }
}
```

- `nextCursor`: Opaque cursor string for requesting the next page. `null` when `hasMore` is `false`.
- `hasMore`: `true` if additional records exist beyond the current page payload; `false` otherwise.
- `totalCount`: Exact total item count if calculated, or `null` if dropped in favor of continuation.
- `isTotalExact`: `true` if `totalCount` is exact; `false` if estimated or omitted.
