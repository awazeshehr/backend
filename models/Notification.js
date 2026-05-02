const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  // Deprecated field, kept for backward compatibility if needed, but we should migrate away from it.
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'recipientModel'
  },
  recipientModel: {
    type: String,
    required: true,
    enum: ['User', 'FieldOfficer', 'DepartmentAdmin', 'SuperAdmin']
  },
  
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['info', 'success', 'warning', 'error'],
    default: 'info'
  },
  relatedTo: {
    type: String,
    enum: ['complaint', 'system', 'profile', 'escalation'],
    default: 'system'
  },
  relatedId: mongoose.Schema.Types.ObjectId,
  
  isRead: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Notification', notificationSchema);
