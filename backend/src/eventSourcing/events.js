"use strict";

const { v4: uuid } = require("uuid");

class DomainEvent {
  static AGGREGATE_TYPE = null;
  static EVENT_TYPE = null;

  constructor({ aggregateId, version, actor, aggregateVersion }) {
    if (!aggregateId) throw new Error("aggregateId is required");
    if (!version || version < 1) throw new Error("version must be >= 1");
    this.eventId = uuid();
    this.aggregateType = this.constructor.AGGREGATE_TYPE;
    this.aggregateId = aggregateId;
    this.eventType = this.constructor.EVENT_TYPE;
    this.version = version;
    this.aggregateVersion = aggregateVersion != null ? aggregateVersion : version;
    this.actor = actor || "system";
    this.occurredAt = new Date().toISOString();
    this.createdAt = new Date().toISOString();
  }

  getStreamId() {
    return `${this.aggregateType}:${this.aggregateId}`;
  }

  toRow() {
    return {
      event_id: this.eventId,
      stream_id: this.getStreamId(),
      aggregate_type: this.aggregateType,
      aggregate_id: this.aggregateId,
      event_type: this.eventType,
      version: this.version,
      aggregate_version: this.aggregateVersion,
      payload: this.toPayload(),
      actor: this.actor,
      occurred_at: this.occurredAt,
      created_at: this.createdAt,
    };
  }

  toPayload() {
    return {
      eventId: this.eventId,
      aggregateType: this.aggregateType,
      aggregateId: this.aggregateId,
      eventType: this.eventType,
      version: this.version,
      aggregateVersion: this.aggregateVersion,
      actor: this.actor,
      occurredAt: this.occurredAt,
      data: this.data || {},
    };
  }
}

class DonationRecordedEvent extends DomainEvent {
  static AGGREGATE_TYPE = "Donation";
  static EVENT_TYPE = "DonationRecorded";

  constructor({ aggregateId, version, actor, projectId, donorAddress, amountXlm, currency = "XLM", message, transactionHash }) {
    super({ aggregateId, version, actor });
    this.data = {
      projectId,
      donorAddress,
      amountXlm: Number.parseFloat(amountXlm),
      currency,
      message: message ? message.trim().slice(0, 100) : null,
      transactionHash,
    };
  }

  toPayload() {
    return {
      ...super.toPayload(),
      data: this.data,
    };
  }
}

class MatchAppliedEvent extends DomainEvent {
  static AGGREGATE_TYPE = "Match";
  static EVENT_TYPE = "MatchApplied";

  constructor({ aggregateId, version, actor, matchId, projectId, donorAddress, matchAmount, originalTxHash, multiplier }) {
    super({ aggregateId, version, actor });
    this.data = {
      matchId,
      projectId,
      donorAddress,
      matchAmount: Number.parseFloat(matchAmount),
      originalTxHash,
      multiplier: Number.parseInt(multiplier, 10) || 1,
    };
  }

  toPayload() {
    return {
      ...super.toPayload(),
      data: this.data,
    };
  }
}

class MatchCreatedEvent extends DomainEvent {
  static AGGREGATE_TYPE = "Match";
  static EVENT_TYPE = "MatchCreated";

  constructor({ aggregateId, version, actor, matchId, projectId, matcherAddress, capXlm, multiplier, expiresAt }) {
    super({ aggregateId, version, actor });
    this.data = {
      matchId,
      projectId,
      matcherAddress,
      capXlm: Number.parseFloat(capXlm),
      multiplier: Number.parseInt(multiplier, 10) || 1,
      expiresAt,
    };
  }

  toPayload() {
    return {
      ...super.toPayload(),
      data: this.data,
    };
  }
}

class ProjectStatusChangedEvent extends DomainEvent {
  static AGGREGATE_TYPE = "Project";
  static EVENT_TYPE = "ProjectStatusChanged";

  constructor({ aggregateId, version, actor, previousStatus, newStatus, reason }) {
    super({ aggregateId, version, actor });
    this.data = {
      previousStatus,
      newStatus,
      reason: reason || null,
    };
  }

  toPayload() {
    return {
      ...super.toPayload(),
      data: this.data,
    };
  }
}

class MilestoneReachedEvent extends DomainEvent {
  static AGGREGATE_TYPE = "Milestone";
  static EVENT_TYPE = "MilestoneReached";

  constructor({ aggregateId, version, actor, milestoneId, projectId, percentage, title, transactionHash }) {
    super({ aggregateId, version, actor });
    this.data = {
      milestoneId,
      projectId,
      percentage: Number.parseInt(percentage, 10) || 0,
      title,
      transactionHash: transactionHash || null,
    };
  }

  toPayload() {
    return {
      ...super.toPayload(),
      data: this.data,
    };
  }
}

class JobReleasedEvent extends DomainEvent {
  static AGGREGATE_TYPE = "Job";
  static EVENT_TYPE = "JobReleased";

  constructor({ aggregateId, version, actor, clientPublicKey, freelancerPublicKey, amountXlm, releaseTransactionHash }) {
    super({ aggregateId, version, actor });
    this.data = {
      clientPublicKey,
      freelancerPublicKey,
      amountXlm: Number.parseFloat(amountXlm),
      releaseTransactionHash,
    };
  }

  toPayload() {
    return {
      ...super.toPayload(),
      data: this.data,
    };
  }
}

class ProjectCreatedEvent extends DomainEvent {
  static AGGREGATE_TYPE = "Project";
  static EVENT_TYPE = "ProjectCreated";

  constructor({ aggregateId, version, actor, name, description, category, location, walletAddress, goalXlm, tags }) {
    super({ aggregateId, version, actor });
    this.data = {
      name,
      description,
      category,
      location,
      walletAddress,
      goalXlm: Number.parseFloat(goalXlm),
      tags: tags || [],
    };
  }

  toPayload() {
    return {
      ...super.toPayload(),
      data: this.data,
    };
  }
}

class ProfileCreatedEvent extends DomainEvent {
  static AGGREGATE_TYPE = "Profile";
  static EVENT_TYPE = "ProfileCreated";

  constructor({ aggregateId, version, actor, displayName, bio }) {
    super({ aggregateId, version, actor });
    this.data = {
      displayName: displayName || null,
      bio: bio ? bio.trim().slice(0, 300) : null,
    };
  }

  toPayload() {
    return {
      ...super.toPayload(),
      data: this.data,
    };
  }
}

class MigratedDonationEvent extends DomainEvent {
  static AGGREGATE_TYPE = "MigratedDonation";
  static EVENT_TYPE = "LegacyDonationMigrated";

  constructor({ originalId, donationId, version, actor, originalCreatedAt, projectId, donorAddress, amountXlm, currency, message, transactionHash, isMatch = false, matchId = null, originalDonationTxHash = null }) {
    super({ aggregateId: donationId, version, actor });
    this.originalId = originalId;
    this.data = {
      projectId,
      donorAddress,
      amountXlm: Number.parseFloat(amountXlm),
      currency: currency || "XLM",
      message: message ? message.trim().slice(0, 100) : null,
      transactionHash,
      originalCreatedAt,
      isMatch,
      matchId,
      originalDonationTxHash,
    };
  }

  toPayload() {
    return {
      ...super.toPayload(),
      data: this.data,
      originalId: this.originalId,
    };
  }
}

function fromPayload(payload) {
  const data = payload.data || {};
  switch (payload.eventType) {
  case "DonationRecorded":
    return new DonationRecordedEvent({
      aggregateId: payload.aggregateId,
      version: payload.version,
      actor: payload.actor,
      projectId: data.projectId,
      donorAddress: data.donorAddress,
      amountXlm: data.amountXlm,
      currency: data.currency,
      message: data.message,
      transactionHash: data.transactionHash,
    });
  case "MatchApplied":
    return new MatchAppliedEvent({
      aggregateId: payload.aggregateId,
      version: payload.version,
      actor: payload.actor,
      matchId: data.matchId,
      projectId: data.projectId,
      donorAddress: data.donorAddress,
      matchAmount: data.matchAmount,
      originalTxHash: data.originalTxHash,
      multiplier: data.multiplier,
    });
  case "MatchCreated":
    return new MatchCreatedEvent({
      aggregateId: payload.aggregateId,
      version: payload.version,
      actor: payload.actor,
      matchId: data.matchId,
      projectId: data.projectId,
      matcherAddress: data.matcherAddress,
      capXlm: data.capXlm,
      multiplier: data.multiplier,
      expiresAt: data.expiresAt,
    });
  case "ProjectStatusChanged":
    return new ProjectStatusChangedEvent({
      aggregateId: payload.aggregateId,
      version: payload.version,
      actor: payload.actor,
      previousStatus: data.previousStatus,
      newStatus: data.newStatus,
      reason: data.reason,
    });
  case "MilestoneReached":
    return new MilestoneReachedEvent({
      aggregateId: payload.aggregateId,
      version: payload.version,
      actor: payload.actor,
      milestoneId: data.milestoneId,
      projectId: data.projectId,
      percentage: data.percentage,
      title: data.title,
      transactionHash: data.transactionHash,
    });
  case "JobReleased":
    return new JobReleasedEvent({
      aggregateId: payload.aggregateId,
      version: payload.version,
      actor: payload.actor,
      clientPublicKey: data.clientPublicKey,
      freelancerPublicKey: data.freelancerPublicKey,
      amountXlm: data.amountXlm,
      releaseTransactionHash: data.releaseTransactionHash,
    });
  case "ProjectCreated":
    return new ProjectCreatedEvent({
      aggregateId: payload.aggregateId,
      version: payload.version,
      actor: payload.actor,
      name: data.name,
      description: data.description,
      category: data.category,
      location: data.location,
      walletAddress: data.walletAddress,
      goalXlm: data.goalXlm,
      tags: data.tags,
    });
  case "ProfileCreated":
    return new ProfileCreatedEvent({
      aggregateId: payload.aggregateId,
      version: payload.version,
      actor: payload.actor,
      displayName: data.displayName,
      bio: data.bio,
    });
  case "LegacyDonationMigrated":
    return new MigratedDonationEvent({
      originalId: payload.originalId,
      donationId: payload.aggregateId,
      version: payload.version,
      actor: payload.actor,
      originalCreatedAt: data.originalCreatedAt,
      projectId: data.projectId,
      donorAddress: data.donorAddress,
      amountXlm: data.amountXlm,
      currency: data.currency,
      message: data.message,
      transactionHash: data.transactionHash,
      isMatch: data.isMatch,
      matchId: data.matchId,
      originalDonationTxHash: data.originalDonationTxHash,
    });
  default:
    throw new Error(`Unknown event type: ${payload.eventType}`);
  }
}

module.exports = {
  DomainEvent,
  DonationRecordedEvent,
  MatchAppliedEvent,
  MatchCreatedEvent,
  ProjectStatusChangedEvent,
  MilestoneReachedEvent,
  JobReleasedEvent,
  ProjectCreatedEvent,
  ProfileCreatedEvent,
  MigratedDonationEvent,
  fromPayload,
};
