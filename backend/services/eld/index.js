/**
 * ELD provider adapter factory.
 *
 * Returns a concrete, stateless provider adapter instance for a given provider
 * key. Adapters normalize each vendor (Motive, Samsara) into a single breadcrumb
 * shape and feed trackingService.recordLocation() — see ./baseProvider.js.
 *
 * Usage:
 *   const { getProvider } = require('../services/eld');
 *   const provider = getProvider(connection.provider);
 *   if (!provider) return res.status(400).json({ error: 'Unsupported ELD provider' });
 *   const points = provider.parseLocations(req.body);
 *
 * Everything here loads without credentials and never touches the network on
 * require — live polling is env-gated inside each provider's fetchLocations().
 */

const MotiveProvider = require('./motiveProvider');
const SamsaraProvider = require('./samsaraProvider');

/** Supported provider keys (matches EldConnection.provider enum subset with adapters). */
const providers = ['motive', 'samsara'];

/**
 * Resolve a provider adapter instance by name.
 * @param {string} name 'motive' | 'samsara'
 * @returns {import('./baseProvider')|null} adapter instance, or null if unsupported
 */
function getProvider(name) {
  switch (name) {
    case 'motive':
      return new MotiveProvider();
    case 'samsara':
      return new SamsaraProvider();
    default:
      return null;
  }
}

module.exports = { getProvider, providers };
