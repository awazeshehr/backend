const codes = require('../constants/errorCodes');

function getCorrelationId(req) {
  return (req && req.correlationId) || (req && req.headers && req.headers['x-correlation-id']) || null;
}

function sendError(req, res, status, opt = {}) {
  const correlationId = getCorrelationId(req);
  const now = new Date().toISOString();
  const { code, message, field, details } = opt;
  const body = {
    success: false,
    message: message || codes[code]?.message || 'Request failed',
    error: {
      code: code || codes.REG_UNKNOWN_ERROR.code,
      message: message || codes[code]?.message || 'Request failed',
      ...(field ? { field } : {}),
      ...(details ? { details } : {}),
      correlationId: correlationId || undefined
    },
    timestamp: now
  };
  if (correlationId) res.setHeader('X-Correlation-Id', correlationId);
  return res.status(status).json(body);
}

module.exports = { sendError, codes };

