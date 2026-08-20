/**
 * src/middleware/validate.test.js
 */
"use strict";

const request = require("supertest");
const express = require("express");
const { z } = require("zod");
const { validate, validateBody, ValidationError } = require("./validate");
const { DonationCreateSchema } = require("../schemas/donations");
const { stellarPublicKey } = require("../schemas/common");

function makeKey(char = "A") {
  return `G${char.repeat(55)}`;
}
function makeTx(char = "a") {
  return char.repeat(64);
}

describe("validateBody", () => {
  test("returns parsed data on success", () => {
    const data = validateBody(DonationCreateSchema, {
      projectId: "p1",
      donorAddress: makeKey("A"),
      transactionHash: makeTx("a"),
    });
    expect(data.donorAddress).toBe(makeKey("A"));
    expect(data.currency).toBe("XLM");
  });

  test("throws ValidationError (status 400) with the first issue message", () => {
    let caught;
    try {
      validateBody(DonationCreateSchema, {
        projectId: "p1",
        donorAddress: "not-a-key",
        transactionHash: makeTx("a"),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught.status).toBe(400);
    expect(caught.message).toBe("Invalid Stellar public key");
  });

  test("reports invalid transaction hash", () => {
    let caught;
    try {
      validateBody(DonationCreateSchema, {
        projectId: "p1",
        donorAddress: makeKey("B"),
        transactionHash: "bad",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught.message).toBe("Invalid transaction hash");
  });
});

describe("validate middleware", () => {
  function buildApp() {
    const app = express();
    app.use(express.json());
    app.post(
      "/donations",
      validate(DonationCreateSchema),
      (req, res) => res.json({ ok: true, body: req.body }),
    );
    app.get(
      "/donor/:publicKey",
      validate(z.object({ publicKey: stellarPublicKey }), { source: "params" }),
      (req, res) => res.json({ ok: true, key: req.params.publicKey }),
    );
    return app;
  }

  test("passes validated body through and strips unknown fields", async () => {
    const res = await request(buildApp())
      .post("/donations")
      .send({
        projectId: "p1",
        donorAddress: makeKey("C"),
        transactionHash: makeTx("c"),
        evil: "should-be-removed",
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.body.evil).toBeUndefined();
  });

  test("rejects invalid body with 400 and { error } envelope", async () => {
    const res = await request(buildApp())
      .post("/donations")
      .send({ donorAddress: makeKey("D"), transactionHash: makeTx("d") });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "projectId is required" });
  });

  test("validates path params", async () => {
    const ok = await request(buildApp()).get(`/donor/${makeKey("E")}`);
    expect(ok.status).toBe(200);
    const bad = await request(buildApp()).get("/donor/not-a-key");
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("Invalid Stellar public key");
  });

  test("calls next() for a valid body", () => {
    const mw = validate(z.object({}), {});
    const next = jest.fn();
    mw({ body: {} }, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

});
