const crypto = require('crypto');

function generateId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

module.exports = function correlationIdMiddleware(req, res, next) {
  const incoming = req.headers['x-correlation-id'];
  req.correlationId = incoming && String(incoming).trim() ? String(incoming).trim() : generateId();
  res.setHeader('X-Correlation-Id', req.correlationId);
  next();
};

