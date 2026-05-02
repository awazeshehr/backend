const jwt = require('jsonwebtoken');
const User = require('../models/User');
const FieldOfficer = require('../models/FieldOfficer');
const DepartmentAdmin = require('../models/DepartmentAdmin');
const SuperAdmin = require('../models/SuperAdmin');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token, authorization denied'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    let user = null;
    // Resolve user from the correct collection based on role embedded in the token
    switch (decoded.role) {
      case 'citizen':
        user = await User.findById(decoded.userId).select('-password');
        break;
      case 'field-officer':
        user = await FieldOfficer.findById(decoded.userId).select('-password');
        break;
      case 'dept-admin':
        user = await DepartmentAdmin.findById(decoded.userId).select('-password');
        break;
      case 'super-admin':
        user = await SuperAdmin.findById(decoded.userId).select('-password');
        break;
      default:
        user = null;
    }
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Token is not valid'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(401).json({
      success: false,
      message: 'Token is not valid'
    });
  }
};

module.exports = auth;