const mongoose = require('mongoose');
const ComplaintCounter = require('./ComplaintCounter');

// Department codes mapping
const DEPARTMENT_CODES = {
  'water': 'WTR',
  'electricity': 'ELEC', 
  'sanitation': 'SAN',
  'roads': 'ROAD',
  'waste': 'WASTE',
  'other': 'GEN'
};

// City codes
const CITY_CODES = {
  'karachi': 'KHI',
  'lahore': 'LHR',
  'islamabad': 'ISB',
  'default': 'PK'
};

const complaintSchema = new mongoose.Schema({
  complaintId: {
    type: String,
    required: true,
    unique: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  category: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  complaintText: {
    type: String,
    trim: true
  },
  location: {
    lat: { 
      type: Number, 
      required: true
    },
    lng: { 
      type: Number, 
      required: true
    },
    address: { type: String, default: 'Location not specified' },
    city: { type: String, default: 'islamabad' },
    areaType: { type: String, enum: ['Urban', 'Rural'], default: 'Urban' },
    sector: { type: String, default: '' },
    ruralJurisdiction: { type: String, default: '' }
  },
  media: [{
    filename: String,
    originalName: String,
    mimetype: String,
    size: Number,
    url: String
  }],
  status: {
    type: String,
    enum: ['pending', 'in-progress', 'resolved', 'completed', 'rejected'],
    default: 'pending'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  priorityColor: {
    type: String,
    default: ''
  },
  modelConfidence: {
    type: Number
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FieldOfficer'
  },
  department: String,
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  service: { type: String }, // Selected service from department

  routingDecision: {
    policyId: { type: mongoose.Schema.Types.ObjectId, ref: 'RoutingPolicy' },
    policyName: { type: String },
    actionType: { type: String, enum: ['route', 'require-approval', 'flag-for-review'] }
  },

  // Reroute request workflow
  rerouteRequest: {
    status: { type: String, enum: ['none','pending','approved','rejected'], default: 'none' },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'DepartmentAdmin' },
    fromDepartmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
    proposedDepartmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
    reason: String,
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SuperAdmin' },
    decidedAt: Date,
    decisionNote: String
  },
  rerouteHistory: [{
    fromDepartmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
    toDepartmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SuperAdmin' },
    reason: String,
    at: { type: Date, default: Date.now }
  }],
 
   remarks: String,
   resolutionDetails: String,
  
  // ✅ Citizen feedback after resolution
  feedback: {
    rating: { type: Number, min: 1, max: 5 },
    comment: String,
    sentiment: { type: String, enum: ['positive', 'neutral', 'negative'] },
    sentimentScore: { type: Number },
    createdAt: Date
  },
  
  // ✅ Timeline of actions for transparency
  timeline: [{
    type: { type: String }, // e.g., submitted, assigned, status-changed, evidence-added, feedback, check-in
    message: String,
    by: { type: mongoose.Schema.Types.ObjectId }, // Removed ref to allow any collection
    byRole: { type: String }, // Track the role of who made the action
    at: { type: Date, default: Date.now },
    meta: mongoose.Schema.Types.Mixed
  }],
  
  // ✅ Field officer GPS check-ins
  checkIns: [{
    officer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    location: {
      lat: Number,
      lng: Number,
      address: String
    },
    at: { type: Date, default: Date.now }
  }],
  
  // ✅ NEW FIELDS FOR FIELD OFFICER
  evidence: [{
    description: String,
    files: [{
      filename: String,
      originalName: String,
      mimetype: String,
      size: Number,
      url: String
    }],
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  officerNotes: String,
  assignedDate: Date,
  resolvedAt: Date,
  
  // Verification fields
  verified: {
    type: Boolean,
    default: false
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  verifiedAt: Date,
  adminComments: String,
  
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Static method to generate complaint ID - GUARANTEED WORKING
complaintSchema.statics.generateComplaintId = async function(category, city = 'karachi') {
  try {
    const currentYear = new Date().getFullYear();
    const cityCode = CITY_CODES[city] || CITY_CODES.default;
    const deptCode = DEPARTMENT_CODES[category] || DEPARTMENT_CODES.other;
    
    // Find the latest complaint for this department and year
    const latestComplaint = await this.findOne({
      complaintId: new RegExp(`^${cityCode}/${deptCode}/${currentYear}/`)
    }).sort({ complaintId: -1 });
    
    let sequence = 1;
    if (latestComplaint && latestComplaint.complaintId) {
      const parts = latestComplaint.complaintId.split('/');
      const lastSeq = parseInt(parts[3]);
      if (!isNaN(lastSeq)) {
        sequence = lastSeq + 1;
      }
    }
    
    const complaintId = `${cityCode}/${deptCode}/${currentYear}/${String(sequence).padStart(4, '0')}`;
    console.log('✅ Generated Complaint ID:', complaintId);
    return complaintId;
    
  } catch (error) {
    console.error('❌ Error generating complaint ID:', error);
    // Fallback ID
    return `EMG/${new Date().getFullYear()}/${Date.now()}`;
  }
};

// New format: CNIC last 3 + year last 2 + per-user yearly sequence
complaintSchema.statics.generateComplaintIdForUser = async function(userId, cnic) {
  try {
    const cleanCNIC = String(cnic || '').replace(/\D/g, '');
    const cnicLast3 = cleanCNIC.slice(-3) || '000';
    const fullYear = new Date().getFullYear();
    const year2 = String(fullYear).slice(-2);

    const counter = await ComplaintCounter.findOneAndUpdate(
      { userId, year: fullYear },
      { $inc: { seq: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const seq = String(counter.seq).padStart(3, '0');
    const complaintId = `${cnicLast3}-${year2}-${seq}`;
    return complaintId;
  } catch (error) {
    const fallback = `${String(cnic || '').slice(-3) || '000'}-${String(new Date().getFullYear()).slice(-2)}-${String(Date.now()).slice(-3)}`;
    return fallback;
  }
};

// ✅ NEW METHOD: Get assigned complaints for field officer
complaintSchema.statics.getAssignedComplaints = async function(fieldOfficerId) {
  return await this.find({ assignedTo: fieldOfficerId })
    .populate('userId', 'fullName email phone')
    .sort({ assignedDate: -1, createdAt: -1 });
};

// ✅ NEW METHOD: Update complaint status
complaintSchema.methods.updateStatus = async function(newStatus, officerId = null) {
  this.status = newStatus;
  this.updatedAt = new Date();
  
  if (newStatus === 'in-progress' && !this.assignedDate) {
    this.assignedDate = new Date();
  }
  
  if (newStatus === 'resolved') {
    this.resolvedAt = new Date();
  }
  
  if (officerId) {
    this.assignedTo = officerId;
  }
  
  // Record timeline entry
  this.timeline.push({
    type: 'status-changed',
    message: `Status updated to ${newStatus}`,
    by: officerId || undefined,
    byRole: officerId ? 'field-officer' : 'system',
    at: new Date(),
    meta: { status: newStatus }
  });
  
  return await this.save();
};

// ✅ NEW METHOD: Add evidence
complaintSchema.methods.addEvidence = async function(evidenceData) {
  this.evidence.push(evidenceData);
  this.updatedAt = new Date();
  this.timeline.push({
    type: 'evidence-added',
    message: 'Evidence uploaded by field officer',
    by: evidenceData.uploadedBy,
    byRole: 'field-officer',
    at: new Date(),
    meta: { filesCount: (evidenceData.files || []).length }
  });
  return await this.save();
};

// ✅ NEW METHOD: Add officer check-in
complaintSchema.methods.addCheckIn = async function(officerId, location) {
  this.checkIns.push({ officer: officerId, location, at: new Date() });
  this.timeline.push({
    type: 'check-in',
    message: 'Field officer checked in on-site',
    by: officerId,
    byRole: 'field-officer',
    at: new Date(),
    meta: { location }
  });
  this.updatedAt = new Date();
  return await this.save();
};

// ✅ NEW METHOD: Set citizen feedback
complaintSchema.methods.setFeedback = async function(rating, comment, userId, sentiment, sentimentScore) {
  this.feedback = {
    rating,
    comment,
    sentiment: sentiment || undefined,
    sentimentScore: typeof sentimentScore === 'number' ? sentimentScore : undefined,
    createdAt: new Date()
  };
  this.timeline.push({
    type: 'feedback',
    message: 'Citizen submitted feedback',
    by: userId,
    byRole: 'citizen',
    at: new Date(),
    meta: { rating }
  });
  this.updatedAt = new Date();
  return await this.save();
};

module.exports = mongoose.model('Complaint', complaintSchema);
