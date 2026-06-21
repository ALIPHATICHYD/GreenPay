"use strict";

const pool = require("../db/pool");
const { dispatchToProjections } = require("./projections");

const EVENT_STORE_BATCH_SIZE = 200;
const EVENT_STORE_POLL_INTERVAL_MS = 500;

let schedulerRunning = false;
let schedulerTimer = null;

class EventStoreService {
  constructor() {
    this.isProcessing = false;
  }

  async append(event) {
    const row = event.toRow();

    try {
      const result = await pool.query(
        `INSERT INTO event_stream (
          event_id, stream_id, aggregate_type, aggregate_id, event_type,
          version, aggregate_version, payload, actor, occurred_at, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)
        ON CONFLICT (stream_id, version) DO UPDATE SET
          payload = event_stream.payload`,
        [
          row.event_id,
          row.stream_id,
          row.aggregate_type,
          row.aggregate_id,
          row.event_type,
          row.version,
          row.aggregate_version,
          JSON.stringify(row.payload),
          row.actor,
          row.occurred_at,
          row.created_at,
        ]
      );
      return { eventId: row.event_id, version: row.version, inserted: (result.rowCount === 1) };
    } catch (err) {
      if (err.code === "23505") {
        throw new Error(`Duplicate event: stream ${row.stream_id} version ${row.version} already exists`);
      }
      throw err;
    }
  }

  async appendBatch(events) {
    const client = await pool.connect();
    let inTransaction = false;
    try {
      await client.query("BEGIN");
      inTransaction = true;
      const results = [];
      for (const event of events) {
        const row = event.toRow();
        await client.query(
          `INSERT INTO event_stream (
            event_id, stream_id, aggregate_type, aggregate_id, event_type,
            version, aggregate_version, payload, actor, occurred_at, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)
          ON CONFLICT (stream_id, version) DO UPDATE SET payload = event_stream.payload`,
          [
            row.event_id,
            row.stream_id,
            row.aggregate_type,
            row.aggregate_id,
            row.event_type,
            row.version,
            row.aggregate_version,
            JSON.stringify(row.payload),
            row.actor,
            row.occurred_at,
            row.created_at,
          ]
        );
        results.push({ eventId: row.event_id, version: row.version });
      }
      await client.query("COMMIT");
      inTransaction = false;
      return results;
    } catch (err) {
      if (inTransaction) await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getUnprocessed(limit = EVENT_STORE_BATCH_SIZE) {
    const result = await pool.query(
      `SELECT event_id, stream_id, aggregate_type, aggregate_id, event_type,
              version, aggregate_version, payload, actor, occurred_at, created_at
       FROM event_stream
       WHERE processed = false
       ORDER BY occurred_at ASC, version ASC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  async markProcessed(eventId) {
    await pool.query(
      "UPDATE event_stream SET processed = true, processed_at = NOW() WHERE event_id = $1",
      [eventId]
    );
  }

  async markProcessedBatch(eventIds) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const eid of eventIds) {
        await client.query(
          "UPDATE event_stream SET processed = true, processed_at = NOW() WHERE event_id = $1",
          [eid]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getStream(aggregateType, aggregateId) {
    const streamId = `${aggregateType}:${aggregateId}`;
    const result = await pool.query(
      `SELECT event_id, stream_id, aggregate_type, aggregate_id, event_type,
          version, aggregate_version, payload, actor, occurred_at, created_at
       FROM event_stream
       WHERE stream_id = $1
       ORDER BY version ASC`,
      [streamId]
    );
    return result.rows;
  }

  async getStreamVersion(aggregateType, aggregateId) {
    const streamId = `${aggregateType}:${aggregateId}`;
    const result = await pool.query(
      "SELECT MAX(version) AS max_version FROM event_stream WHERE stream_id = $1",
      [streamId]
    );
    return result.rows[0]?.max_version || 0;
  }

  async processBatch(limit = EVENT_STORE_BATCH_SIZE) {
    if (this.isProcessing) return { processed: 0, failed: 0 };
    this.isProcessing = true;

    try {
      const batch = await this.getUnprocessed(limit);
      if (batch.length === 0) return { processed: 0, failed: 0 };

      const { fromPayload } = require("./events");
      const processedIds = [];
      let failedCount = 0;

      for (const row of batch) {
        try {
          const event = fromPayload(row.payload);
          await dispatchToProjections(pool, event);
          processedIds.push(row.event_id);
        } catch (err) {
          console.error(`[EventStore] Failed to dispatch event ${row.event_id}:`, err.message);
          failedCount++;
        }
      }

      if (processedIds.length > 0) {
        await this.markProcessedBatch(processedIds);
      }

      return { processed: processedIds.length, failed: failedCount, total: batch.length };
    } catch (err) {
      console.error("[EventStore] Batch processing error:", err.message);
      return { processed: 0, failed: 0, error: err.message };
    } finally {
      this.isProcessing = false;
    }
  }

  async startScheduler() {
    if (schedulerRunning) return;
    schedulerRunning = true;
    console.log("[EventStore] Scheduler started");

    schedulerTimer = setInterval(async () => {
      const result = await this.processBatch(EVENT_STORE_BATCH_SIZE);
      if (result.processed > 0 || result.failed > 0) {
        console.log(
          `[EventStore] Dispatch: ${result.processed} processed, ${result.failed} failed, ${result.total || 0} total`
        );
      }
    }, EVENT_STORE_POLL_INTERVAL_MS);
  }

  async stopScheduler() {
    schedulerRunning = false;
    if (schedulerTimer) {
      clearInterval(schedulerTimer);
      schedulerTimer = null;
    }
    console.log("[EventStore] Scheduler stopped");
  }
}

const eventStore = new EventStoreService();

module.exports = {
  EventStoreService,
  eventStore,
};
