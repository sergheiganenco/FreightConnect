/**
 * EldConnection model
 *
 * Stores a carrier's credentials/configuration for a Tier-2 ELD / telematics
 * provider integration (Motive, Samsara, Geotab). A connection lets FreightConnect
 * ingest vehicle GPS breadcrumbs from the provider — either pushed via the
 * provider's webhook or pulled by a polling job — and feed them into the unified
 * trackingService.recordLocation() pipeline.
 *
 * Security:
 *   - apiToken and webhookSecret are stored with select:false so they are NEVER
 *     returned by default queries. Use .select('+apiToken +webhookSecret')
 *     explicitly (and only inside trusted server-side flows) when you need them.
 *   - Secrets must NEVER be logged.
 *
 * Status lifecycle: active → disabled | error (and back to active on repair).
 *
 * vehicleMap maps a provider-side vehicleId to the carrier's internal driver/note
 * so an inbound breadcrumb can be associated with the right load/driver downstream.
 */

const mongoose = require('mongoose');

const VehicleMapEntrySchema = new mongoose.Schema({
  vehicleId: { type: String, required: true },   // provider-side vehicle identifier
  driverId:  { type: String, default: null },    // carrier-side driver reference (optional)
  note:      { type: String, default: '' },
}, { _id: false });

const EldConnectionSchema = new mongoose.Schema({
  // ── Owner ─────────────────────────────────────────────────────────────────
  carrier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },

  // ── Provider ──────────────────────────────────────────────────────────────
  provider: {
    type: String,
    enum: ['motive', 'samsara', 'geotab'],
    required: true,
  },

  // ── Credentials (secret — never returned by default, never logged) ─────────
  apiToken:      { type: String, select: false, default: null },
  accountId:     { type: String, default: null },   // provider org/account id (not secret)
  webhookSecret: { type: String, select: false, default: null },

  // ── Vehicle ↔ driver mapping ──────────────────────────────────────────────
  vehicleMap: { type: [VehicleMapEntrySchema], default: [] },

  // ── Status / health ───────────────────────────────────────────────────────
  status: {
    type: String,
    enum: ['active', 'disabled', 'error'],
    default: 'active',
    index: true,
  },
  lastSyncAt: { type: Date, default: null },
  lastError:  { type: String, default: null },

}, { timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' } });

// One connection per carrier per provider.
EldConnectionSchema.index({ carrier: 1, provider: 1 }, { unique: true });

/**
 * Find all active connections for a given provider. Used by the polling job to
 * iterate connections that should be synced. Does NOT include secret fields by
 * default — callers that need apiToken must add .select('+apiToken') explicitly.
 *
 * @param {('motive'|'samsara'|'geotab')} provider
 * @returns {Promise<Array>} active connections for that provider
 */
EldConnectionSchema.statics.findActiveByProvider = function (provider) {
  return this.find({ provider, status: 'active' });
};

/**
 * Resolve the carrier-side driver mapping for a provider vehicleId.
 * Returns the matching vehicleMap entry, or null if the vehicle is unmapped.
 *
 * @param {string} vehicleId provider-side vehicle identifier
 * @returns {{vehicleId:string,driverId:?string,note:string}|null}
 */
EldConnectionSchema.methods.resolveVehicle = function (vehicleId) {
  if (!vehicleId) return null;
  const entry = (this.vehicleMap || []).find((v) => String(v.vehicleId) === String(vehicleId));
  return entry || null;
};

module.exports = mongoose.model('EldConnection', EldConnectionSchema);
