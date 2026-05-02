const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  complaintId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Complaint',
    required: false
  },
  recipientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  senderRole: {
    type: String,
    enum: ['citizen', 'field-officer', 'dept-admin', 'super-admin'],
    required: true
  },
  templateKey: {
    type: String
  },
  notes: {
    type: String,
    trim: true
  },
  text: {
    type: String,
    trim: true,
    required: true
  },
  attachments: [{
    filename: String,
    url: String,
    mimetype: String,
    size: Number
  }],
  status: {
    type: String,
    enum: ['sent', 'delivered', 'seen'],
    default: 'sent'
  },
  deliveredAt: { type: Date },
  seenAt: { type: Date },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

messageSchema.index({ recipientId: 1, senderId: 1, createdAt: 1 });
messageSchema.index({ complaintId: 1, createdAt: 1 });

module.exports = mongoose.model('Message', messageSchema);



