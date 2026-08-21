/**
 * src/schemas/projects.js
 *
 * Declarative request schemas for project mutating routes.
 * Mirrors docs/openapi.yml `/api/projects/{id}/status` (updateProjectStatus).
 */
"use strict";

const { z } = require("zod");
const { stellarPublicKey } = require("./common");

const VALID_STATUSES = ["active", "rejected", "paused"];

const ProjectStatusUpdateSchema = z.object({
  status: z.enum(VALID_STATUSES, { required_error: "status is required" }),
  reason: z.string().max(500).optional().nullable(),
  // The audit log previously accepted an absent adminAddress ("unknown").
  // We now require a well-formed Stellar public key so the actor is
  // accountable. Authorization (ownership / admin role) is enforced
  // separately by the route handler.
  adminAddress: stellarPublicKey,
});

module.exports = { ProjectStatusUpdateSchema, VALID_STATUSES };
