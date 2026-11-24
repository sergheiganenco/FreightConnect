/**
 * Dock details are for the parties to a load only.
 *
 * The pickup number is what a dock releases freight against, and the facility contacts are who a
 * thief would call. A carrier browsing the board must not get them. Loads leave the API through many
 * routes (board, search, recommendations, trip planner ...), so this is enforced once, on the way out:
 * any load in any JSON response loses these fields unless the caller posted it, booked it, or is an admin.
 */
const SECRET_FIELDS = [
  'pickupNumber', 'deliveryContactEmail',
  'pickupContactName', 'pickupContactPhone', 'deliveryContactName', 'deliveryContactPhone',
];
const idOf = (v) => (v && typeof v === 'object' ? String(v._id || v.id || '') : v ? String(v) : '');
const looksLikeLoad = (o) => 'postedBy' in o && 'origin' in o && 'destination' in o && 'equipmentType' in o;

function redact(node, me, isAdmin, depth) {
  if (!node || typeof node !== 'object' || depth > 8) return;
  if (Array.isArray(node)) { for (const x of node) redact(x, me, isAdmin, depth + 1); return; }
  if (looksLikeLoad(node) && !isAdmin && !(me && (idOf(node.postedBy) === me || idOf(node.acceptedBy) === me))) {
    for (const f of SECRET_FIELDS) delete node[f];
  }
  for (const k of Object.keys(node)) if (node[k] && typeof node[k] === 'object') redact(node[k], me, isAdmin, depth + 1);
}

module.exports = function redactLoadSecrets(req, res, next) {
  const send = res.json.bind(res);
  res.json = (body) => {
    if (!body || typeof body !== 'object') return send(body);
    try {
      const plain = JSON.parse(JSON.stringify(body)); // documents become what would be sent anyway
      const u = req.user;
      redact(plain, u ? String(u.companyOwnerId || u.userId || '') : '', !!u && u.role === 'admin', 0);
      return send(plain);
    } catch (_) {
      return send(body);
    }
  };
  next();
};
module.exports.SECRET_FIELDS = SECRET_FIELDS;
