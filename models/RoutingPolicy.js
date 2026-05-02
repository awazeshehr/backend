const mongoose = require('mongoose');

const routingPolicySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  enabled: { type: Boolean, default: true },
  priority: { type: Number, default: 100 },
  match: {
    categoryKey: { type: String, required: true, trim: true, lowercase: true },
    categoryName: { type: String, default: '', trim: true },
    areaType: { type: String, enum: ['Any', 'Urban', 'Rural'], default: 'Any' },
    sector: { type: String, default: '', trim: true },
    ruralJurisdiction: { type: String, default: '', trim: true }
  },
  conditions: {
    allowedPriorities: { type: [String], enum: ['low', 'medium', 'high', 'critical'], default: [] },
    keywords: { type: [String], default: [] },
    maxOpenComplaints: { type: Number, default: null },
    timeWindow: {
      daysOfWeek: { type: [Number], default: [] },
      startMinutes: { type: Number, default: null },
      endMinutes: { type: Number, default: null }
    }
  },
  action: {
    type: { type: String, enum: ['route', 'require-approval', 'flag-for-review'], default: 'route' },
    departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
    note: { type: String, default: '', trim: true }
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SuperAdmin' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

routingPolicySchema.index({ 'match.categoryKey': 1, priority: 1, enabled: 1 });

routingPolicySchema.pre('validate', function (next) {
  const name = String(this.name || '').trim();
  this.name = name || 'Routing Policy';
  const categoryName = String(this.match?.categoryName || '').trim();
  const key = String(this.match?.categoryKey || categoryName).trim().toLowerCase();
  this.match = this.match || {};
  this.match.categoryName = categoryName;
  this.match.categoryKey = key;

  const keywords = Array.isArray(this.conditions?.keywords) ? this.conditions.keywords : [];
  this.conditions = this.conditions || {};
  this.conditions.keywords = keywords.map(k => String(k || '').trim()).filter(Boolean);

  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('RoutingPolicy', routingPolicySchema);
