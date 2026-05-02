const mongoose = require('mongoose');

const complaintCounterSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  year: {
    type: Number,
    required: true
  },
  seq: {
    type: Number,
    default: 0
  }
});

complaintCounterSchema.index({ userId: 1, year: 1 }, { unique: true });

module.exports = mongoose.model('ComplaintCounter', complaintCounterSchema);

