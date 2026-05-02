module.exports = function authorizeRoles(...allowedRoles) {
  // If last arg is an options object, pop it
  let options = {};
  if (allowedRoles.length > 0 && typeof allowedRoles[allowedRoles.length - 1] === 'object') {
    options = allowedRoles.pop();
  }

  return async (req, res, next) => {
    try {
      const role = req.user?.role;
      if (!role || !allowedRoles.includes(role)) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      // Super admin bypass
      if (role === 'super-admin') return next();
      return next();
    } catch (e) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
  };
};
