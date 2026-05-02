const express = require('express');
const Complaint = require('../models/Complaint');
const Notification = require('../models/Notification');
const Department = require('../models/Department');
const FieldOfficer = require('../models/FieldOfficer');
const UrbanSector = require('../models/UrbanSector');
const RuralJurisdiction = require('../models/RuralJurisdiction');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const CategoryDepartmentMapping = require('../models/CategoryDepartmentMapping');
const { classifyComplaint } = require('../services/complaintClassifierService');
const { analyzeFeedbackSentiment } = require('../services/feedbackSentimentService');
const SuperAdmin = require('../models/SuperAdmin');

// Configure Multer for disk storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 5 }
});

// Department codes mapping
const DEPARTMENT_CODES = {
  'water': 'WTR',
  'electricity': 'ELEC',
  'sanitation': 'SAN',
  'roads': 'ROAD',
  'waste': 'WASTE',
  'other': 'GEN'
};

function escapeRegExp(input) {
  return String(input || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ✅ CITIZEN ROUTES

// Get Urban Sectors
router.get('/data/sectors', auth, async (req, res) => {
  try {
    const sectors = await UrbanSector.find({}).sort({ name: 1 });
    res.json({ success: true, sectors });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to fetch sectors' });
  }
});

// Get Rural Jurisdictions
router.get('/data/jurisdictions', auth, async (req, res) => {
  try {
    const jurisdictions = await RuralJurisdiction.find({}).sort({ name: 1 });
    res.json({ success: true, jurisdictions });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to fetch jurisdictions' });
  }
});

// Get Active Departments with Services
router.get('/data/departments', auth, async (req, res) => {
  try {
    const departments = await Department.find({ isActive: true }).select('name areaTypes sectors ruralJurisdictions servicesOffered');
    res.json({ success: true, departments });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to fetch departments' });
  }
});

// Submit new complaint - GUARANTEED WORKING VERSION
router.post('/submit', auth, authorize('citizen'), upload.array('media', 5), async (req, res) => {
  try {
    const { description, departmentId, service } = req.body;
    let { location } = req.body;

    console.log('📝 Submitting professional complaint for user:', req.user._id);

    // Parse location if it's a string (from FormData)
    if (typeof location === 'string') {
      try {
        location = JSON.parse(location);
      } catch (e) {
        console.error('Failed to parse location JSON:', e);
        return res.status(400).json({
          success: false,
          message: 'Invalid location format'
        });
      }
    }

    // Validation
    if (!description || !location) {
      return res.status(400).json({
        success: false,
        message: 'Description and location are required fields'
      });
    }

    if (!location.lat || !location.lng) {
      return res.status(400).json({
        success: false,
        message: 'Valid location coordinates are required'
      });
    }

    const cleanedText = String(description || '').trim();
    const classification = await classifyComplaint(cleanedText);
    const resolvedCategory = classification.category;
    const finalPriority = classification.priority;
    const priorityColor = classification.priority_color;
    const modelConfidence = classification.confidence;

    let resolvedDepartmentName = '';
    let resolvedDepartmentId = departmentId;
    try {
      const categoryKey = String(resolvedCategory || '').trim().toLowerCase();
      const mapping = await CategoryDepartmentMapping.findOne({ $or: [{ categoryKey }, { categoryName: String(resolvedCategory || '').trim() }] })
        .populate('departmentId', 'name');
      if (mapping?.departmentId?._id) {
        resolvedDepartmentId = mapping.departmentId._id;
        resolvedDepartmentName = mapping.departmentId.name;
      } else if (resolvedDepartmentId) {
        const dep = await Department.findById(resolvedDepartmentId).select('name');
        if (dep) resolvedDepartmentName = dep.name;
      }
    } catch (e) {}
    if (!resolvedDepartmentId) {
      try {
        const dep = await Department.findOne({ isActive: true }).sort({ createdAt: 1 }).select('name');
        if (dep?._id) {
          resolvedDepartmentId = dep._id;
          resolvedDepartmentName = dep.name;
        }
      } catch (e) {}
    }

    // Check for duplicate complaints (Same category + Nearby location + Active status)
    const lat = parseFloat(location.lat);
    const lng = parseFloat(location.lng);
    const DUPLICATE_THRESHOLD = 0.0005; // Approx 50 meters

    const duplicateComplaint = await Complaint.findOne({
      category: resolvedCategory,
      status: { $in: ['pending', 'in-progress', 'assigned'] },
      'location.lat': { $gt: lat - DUPLICATE_THRESHOLD, $lt: lat + DUPLICATE_THRESHOLD },
      'location.lng': { $gt: lng - DUPLICATE_THRESHOLD, $lt: lng + DUPLICATE_THRESHOLD }
    });

    if (duplicateComplaint) {
      // Clean up uploaded files since we are rejecting the request
      if (req.files && req.files.length > 0) {
        req.files.forEach(file => {
          try {
            if (file.path && fs.existsSync(file.path)) {
              fs.unlinkSync(file.path);
            }
          } catch (e) {
            console.error('Error deleting file:', e);
          }
        });
      }

      return res.status(409).json({
        success: false,
        message: 'A similar active complaint already exists in this area. Please avoid duplicate reporting.',
        duplicateId: duplicateComplaint.complaintId
      });
    }

    // Process uploaded files
    const mediaFiles = (req.files || []).map(file => ({
      url: `/uploads/${file.filename}`,
      type: file.mimetype.startsWith('video') ? 'video' : 'image',
      name: file.originalname
    }));

    // Generate complaint ID
    const complaintId = await Complaint.generateComplaintIdForUser(req.user._id, req.user.cnic);
    console.log('✅ Using Complaint ID:', complaintId);

    // Create complaint with pre-generated ID
    const complaintData = {
              complaintId: complaintId, // Explicitly set the ID
              userId: req.user._id,
              category: resolvedCategory,
              service, // Save the specific service selected
              departmentId: resolvedDepartmentId, // Save the department reference
              description: cleanedText,
              complaintText: cleanedText,
              location: {
                lat: parseFloat(location.lat),
                lng: parseFloat(location.lng),
                address: location.address || 'Address not specified',
                city: 'islamabad',
                areaType: location.areaType || 'Urban',
                sector: location.sector || '',
                ruralJurisdiction: location.ruralJurisdiction || ''
              },
              media: mediaFiles,
              status: 'pending',
              priority: finalPriority,
              priorityColor: priorityColor,
              modelConfidence: modelConfidence,
              department: resolvedDepartmentName
            };

    const complaint = new Complaint(complaintData);

    console.log('💾 Saving complaint with ID:', complaintId);
    await complaint.save();
    // Record timeline: submitted
    complaint.timeline = complaint.timeline || [];
    complaint.timeline.push({
      type: 'submitted',
      message: 'Complaint submitted by citizen',
      by: req.user._id,
      byRole: req.user.role,
      at: new Date(),
      meta: { category: resolvedCategory }
    });
    await complaint.save();
    console.log('✅ Complaint saved successfully');

    // Attempt auto-routing to officer
    try {
      const assignmentService = require('../services/assignmentService');
      const routeResult = await assignmentService.routeComplaint(complaint);
      if (routeResult.assigned && routeResult.officer) {
        // Notify assigned officer
        const notifToOfficer = new Notification({
          recipient: routeResult.officer._id,
          recipientModel: 'FieldOfficer',
          title: 'New Complaint Assigned',
          message: `Complaint ${complaint.complaintId} has been assigned to you.`,
          type: 'info',
          relatedTo: 'complaint',
          relatedId: complaint._id
        });
        await notifToOfficer.save();
      }
    } catch (e) {
      console.error('Auto-routing failed:', e);
    }

    // Create notification
    const notification = new Notification({
      recipient: req.user._id,
      recipientModel: 'User',
      title: 'Complaint Registered Successfully',
      message: `Your complaint ${complaint.complaintId} has been registered. Our team will review it shortly.`,
      type: 'success',
      relatedTo: 'complaint',
      relatedId: complaint._id
    });

    await notification.save();

    res.status(201).json({
      success: true,
      message: 'Complaint registered successfully',
      complaint: {
        _id: complaint._id,
        complaintId: complaint.complaintId,
        category: complaint.category,
        description: complaint.description,
        status: complaint.status,
        priority: complaint.priority,
        createdAt: complaint.createdAt,
        location: complaint.location,
        department: complaint.department
      }
    });

  } catch (error) {
    console.error('❌ Professional complaint submission error:', error);
    
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Data validation failed',
        errors: errors
      });
    }
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Complaint ID already exists. Please try again.'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Internal server error while processing complaint'
    });
  }
});

// Add citizen evidence
router.post('/:id/citizen-evidence', auth, authorize('citizen'), upload.array('evidence', 5), async (req, res) => {
  try {
    const { description } = req.body;
    
    const complaint = await Complaint.findOne({ 
      _id: req.params.id, 
      userId: req.user._id 
    });

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found'
      });
    }

    const files = (req.files || []).map(file => ({
      url: `/uploads/${file.filename}`,
      type: file.mimetype.startsWith('video') ? 'video' : 'image',
      name: file.originalname
    }));

    const evidenceData = {
      description: description || 'Additional evidence by citizen',
      files,
      uploadedBy: req.user._id,
      uploadedAt: new Date()
    };

    complaint.evidence = complaint.evidence || [];
    complaint.evidence.push(evidenceData);
    await complaint.save();

    res.json({
      success: true,
      message: 'Evidence added successfully',
      complaint: {
        id: complaint._id,
        evidence: complaint.evidence
      }
    });

  } catch (error) {
    console.error('Error adding citizen evidence:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while adding evidence'
    });
  }
});

// Get user complaints (Citizen)
router.get('/my-complaints', auth, authorize('citizen'), async (req, res) => {
  try {
    const complaints = await Complaint.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .select('-__v')
      .populate('assignedTo', 'fullName email');

    res.json({
      success: true,
      complaints
    });

  } catch (error) {
    console.error('Get complaints error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching complaints'
    });
  }
});

// Get complaint by ID (Role-based access)
router.get('/:id', auth, async (req, res) => {
  try {
    let query = { _id: req.params.id };
    
    // Role-based filtering
    switch (req.user.role) {
      case 'citizen':
        query.userId = req.user._id;
        break;
      case 'field-officer':
        query.$or = [
          { assignedTo: req.user._id },
          { userId: req.user._id }
        ];
        break;
      case 'dept-admin':
        query.department = req.user.department;
        break;
      case 'super-admin':
        // Super admin can see all complaints
        break;
      default:
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
    }

    const complaint = await Complaint.findOne(query)
      .select('-__v')
      .populate('assignedTo', 'fullName email phone')
      .populate('userId', 'fullName email contactNumber');

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found'
      });
    }

    res.json({
      success: true,
      complaint
    });

  } catch (error) {
    console.error('Get complaint error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching complaint'
    });
  }
});

// ✅ FIELD OFFICER ROUTES

// Get assigned complaints for field officer
router.get('/field-officer/assigned', auth, authorize('field-officer'), async (req, res) => {
  try {
    // Check if user is field officer
    if (req.user.role !== 'field-officer') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Field officer only.'
      });
    }

    const complaints = await Complaint.getAssignedComplaints(req.user._id);

    res.json({
      success: true,
      complaints: complaints.map(complaint => ({
        id: complaint._id,
        complaintId: complaint.complaintId,
        title: complaint.description.substring(0, 50) + (complaint.description.length > 50 ? '...' : ''),
        description: complaint.description,
        category: complaint.category,
        location: complaint.location.address,
        status: complaint.status,
        priority: complaint.priority,
        citizenName: complaint.userId?.fullName || 'N/A',
        contactNumber: complaint.userId?.phone || 'N/A',
        assignedDate: complaint.assignedDate,
        createdAt: complaint.createdAt,
        media: complaint.media || [],
        evidence: complaint.evidence || []
      }))
    });
  } catch (error) {
    console.error('Error fetching assigned complaints:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching assigned complaints'
    });
  }
});

// Get complaints by field officer department/category match (auto-visible)
router.get('/field-officer/by-department', auth, authorize('field-officer'), async (req, res) => {
  try {
    if (req.user.role !== 'field-officer') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Field officer only.'
      });
    }

    const deptName = String(req.user.department || '').trim();
    const departmentMatcher = deptName ? new RegExp(`^${escapeRegExp(deptName)}$`, 'i') : null;

    // Fetch complaints matching categories. Include both unassigned and ones already assigned to this officer
    const complaints = await Complaint.find(departmentMatcher ? { department: departmentMatcher } : {})
    .populate('userId', 'fullName email phone')
    .sort({ createdAt: -1 });

    res.json({
      success: true,
      complaints: complaints.map(complaint => ({
        id: complaint._id,
        complaintId: complaint.complaintId,
        title: complaint.description.substring(0, 50) + (complaint.description.length > 50 ? '...' : ''),
        description: complaint.description,
        category: complaint.category,
        location: complaint.location?.address,
        status: complaint.status,
        priority: complaint.priority,
        citizenName: complaint.userId?.fullName || 'N/A',
        contactNumber: complaint.userId?.phone || 'N/A',
        assignedDate: complaint.assignedDate,
        createdAt: complaint.createdAt,
        media: complaint.media || [],
        evidence: complaint.evidence || [],
        assignedTo: complaint.assignedTo || null
      }))
    });
  } catch (error) {
    console.error('Error fetching department complaints:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching department complaints'
    });
  }
});

// Update complaint status (Field Officer)
router.put('/:id/status', auth, authorize('field-officer'), async (req, res) => {
  try {
    const { status } = req.body;
    
    // Check if user is field officer
    if (req.user.role !== 'field-officer') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Field officer only.'
      });
    }

    // First try: complaint already assigned to this officer
    let complaint = await Complaint.findOne({ 
      _id: req.params.id, 
      assignedTo: req.user._id 
    });

    // Fallback: auto-assign if the complaint category matches officer department
    if (!complaint) {
      const deptName = String(req.user.department || '').trim();
      const departmentMatcher = deptName ? new RegExp(`^${escapeRegExp(deptName)}$`, 'i') : null;
      complaint = await Complaint.findOne({
        _id: req.params.id,
        ...(departmentMatcher ? { department: departmentMatcher } : {})
      });

      if (!complaint) {
        return res.status(404).json({
          success: false,
          message: 'Complaint not found or not assigned to you'
        });
      }

      // Auto-assign to this officer before updating status
      if (!complaint.assignedTo) {
        complaint.assignedTo = req.user._id;
        if (!complaint.assignedDate) {
          complaint.assignedDate = new Date();
        }
        await complaint.save();
      }
    }

    await complaint.updateStatus(status, req.user._id);

    // Emit real-time update to Department Admin
    if (global.io) {
      global.io.emit('complaintUpdate', {
        complaintId: complaint._id,
        status: status,
        department: req.user.department,
        updatedBy: req.user._id,
        action: 'status_update'
      });
    }

    // Create notification for citizen
    const notification = new Notification({
      recipient: complaint.userId,
      recipientModel: 'User',
      title: 'Complaint Status Updated',
      message: `Your complaint ${complaint.complaintId} status has been updated to ${status}.`,
      type: 'info',
      relatedTo: 'complaint',
      relatedId: complaint._id
    });

    await notification.save();

    res.json({
      success: true,
      message: `Complaint status updated to ${status}`,
      complaint: {
        id: complaint._id,
        complaintId: complaint.complaintId,
        status: complaint.status,
        updatedAt: complaint.updatedAt
      }
    });
  } catch (error) {
    console.error('Error updating complaint status:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating complaint status'
    });
  }
});

// Upload evidence (Field Officer)
router.post('/:id/evidence', auth, authorize('field-officer'), upload.array('evidence', 5), async (req, res) => {
  try {
    const { description } = req.body;
    
    // Check if user is field officer
    if (req.user.role !== 'field-officer') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Field officer only.'
      });
    }

    const complaint = await Complaint.findOne({ 
      _id: req.params.id, 
      assignedTo: req.user._id 
    });

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found or not assigned to you'
      });
    }

    const files = (req.files || []).map(file => ({
      filename: file.filename,
      originalName: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      url: `/uploads/${file.filename}`
    }));

    const evidenceData = {
      description,
      files,
      uploadedBy: req.user._id
    };

    await complaint.addEvidence(evidenceData);

    // Auto mark as in progress when evidence uploaded
    if (complaint.status === 'pending') {
      await complaint.updateStatus('in-progress', req.user._id);
    }

    // Create notification for citizen
    const notification = new Notification({
      userId: complaint.userId,
      title: 'Evidence Added to Your Complaint',
      message: `Field officer has added evidence to your complaint ${complaint.complaintId}.`,
      type: 'info',
      relatedTo: 'complaint',
      relatedId: complaint._id
    });

    await notification.save();

    res.json({
      success: true,
      message: 'Evidence uploaded successfully',
      complaint: {
        id: complaint._id,
        complaintId: complaint.complaintId,
        status: complaint.status,
        evidence: complaint.evidence
      }
    });
  } catch (error) {
    console.error('Error uploading evidence:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while uploading evidence'
    });
  }
});

// Citizen feedback on resolved complaint
router.post('/:id/feedback', auth, authorize('citizen'), async (req, res) => {
  try {
    const { rating, comment } = req.body;

    // Only complaint owner can submit feedback
    const complaint = await Complaint.findOne({ _id: req.params.id, userId: req.user._id });
    if (!complaint) {
      return res.status(404).json({ success: false, message: 'Complaint not found' });
    }

    if (complaint.status !== 'resolved') {
      return res.status(400).json({ success: false, message: 'Feedback allowed only after resolution' });
    }

    const sentiment = await analyzeFeedbackSentiment(comment);
    await complaint.setFeedback(Number(rating), comment, req.user._id, sentiment.sentiment, sentiment.compound_score);

    // Notify assigned officer (if any)
    if (complaint.assignedTo) {
      const notif = new Notification({
        recipient: complaint.assignedTo,
        recipientModel: 'FieldOfficer',
        title: 'Citizen Feedback Received',
        message: `Feedback received for ${complaint.complaintId} (rating: ${rating}).`,
        type: 'info',
        relatedTo: 'complaint',
        relatedId: complaint._id
      });
      await notif.save();
    }

    res.json({ success: true, message: 'Feedback submitted', feedback: complaint.feedback });
  } catch (error) {
    console.error('Error submitting feedback:', error);
    res.status(500).json({ success: false, message: 'Server error while submitting feedback' });
  }
});

// Field officer GPS check-in
router.post('/:id/check-in', auth, authorize('field-officer'), async (req, res) => {
  try {
    const { location } = req.body; // { lat, lng, address }
    if (req.user.role !== 'field-officer') {
      return res.status(403).json({ success: false, message: 'Access denied. Field officer only.' });
    }

    // Ensure assignment or auto-assign if category matches
    let complaint = await Complaint.findOne({ _id: req.params.id, assignedTo: req.user._id });
    if (!complaint) {
      const deptName = String(req.user.department || '').trim();
      const departmentMatcher = deptName ? new RegExp(`^${escapeRegExp(deptName)}$`, 'i') : null;
      complaint = await Complaint.findOne({ _id: req.params.id, ...(departmentMatcher ? { department: departmentMatcher } : {}) });
      if (!complaint) {
        return res.status(404).json({ success: false, message: 'Complaint not found or not assigned to you' });
      }
      if (!complaint.assignedTo) {
        complaint.assignedTo = req.user._id;
        if (!complaint.assignedDate) complaint.assignedDate = new Date();
        await complaint.save();
      }
    }

    const safeLocation = {
      lat: Number(location?.lat),
      lng: Number(location?.lng),
      address: location?.address || ''
    };

    await complaint.addCheckIn(req.user._id, safeLocation);

    // Update field officer current location
    await FieldOfficer.findByIdAndUpdate(req.user._id, {
      currentLocation: {
        ...safeLocation,
        updatedAt: new Date()
      }
    });

    // Emit socket event for real-time tracking
    if (global.io) {
      global.io.emit('officerLocationUpdate', {
        officerId: req.user._id,
        location: safeLocation
      });
    }

    res.json({ success: true, message: 'Check-in recorded', checkIns: complaint.checkIns });
  } catch (error) {
    console.error('Error recording check-in:', error);
    res.status(500).json({ success: false, message: 'Server error while recording check-in' });
  }
});

// Save officer notes
router.post('/:id/notes', auth, authorize('field-officer'), async (req, res) => {
  try {
    const { notes } = req.body;
    
    // Check if user is field officer
    if (req.user.role !== 'field-officer') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Field officer only.'
      });
    }

    const complaint = await Complaint.findOneAndUpdate(
      { 
        _id: req.params.id, 
        assignedTo: req.user._id 
      },
      { 
        officerNotes: notes,
        updatedAt: new Date()
      },
      { new: true }
    );

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found or not assigned to you'
      });
    }

    res.json({
      success: true,
      message: 'Notes saved successfully',
      complaint: {
        id: complaint._id,
        complaintId: complaint.complaintId,
        officerNotes: complaint.officerNotes
      }
    });
  } catch (error) {
    console.error('Error saving notes:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while saving notes'
    });
  }
});

// Get complaint details for field officer
router.get('/field-officer/:id', auth, authorize('field-officer'), async (req, res) => {
  try {
    // Check if user is field officer
    if (req.user.role !== 'field-officer') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Field officer only.'
      });
    }

    const complaint = await Complaint.findOne({
      _id: req.params.id,
      assignedTo: req.user._id
    })
    .populate('userId', 'fullName email phone')
    .populate('assignedTo', 'fullName email');

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found or not assigned to you'
      });
    }

    res.json({
      success: true,
      complaint: {
        id: complaint._id,
        complaintId: complaint.complaintId,
        description: complaint.description,
        category: complaint.category,
        location: complaint.location,
        status: complaint.status,
        priority: complaint.priority,
        citizenName: complaint.userId?.fullName,
        contactNumber: complaint.userId?.phone,
        email: complaint.userId?.email,
        assignedDate: complaint.assignedDate,
        createdAt: complaint.createdAt,
        media: complaint.media,
        evidence: complaint.evidence,
        officerNotes: complaint.officerNotes,
        resolutionDetails: complaint.resolutionDetails
      }
    });
  } catch (error) {
    console.error('Error fetching complaint details:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching complaint details'
    });
  }
});

// Emergency backup route - Simple ID generation
router.post('/submit-simple', auth, async (req, res) => {
  try {
    const { description, location, departmentId } = req.body;
    const cleanedText = String(description || '').trim();
    const classification = await classifyComplaint(cleanedText);

    // Simple timestamp-based ID (guaranteed to work)
    const currentYear = new Date().getFullYear();
    const timestamp = Date.now();
    const complaintId = `KHI/GEN/${currentYear}/${timestamp}`;

    let resolvedDepartmentName = '';
    let resolvedDepartmentId = departmentId;
    try {
      const categoryKey = String(classification.category || '').trim().toLowerCase();
      const mapping = await CategoryDepartmentMapping.findOne({ $or: [{ categoryKey }, { categoryName: String(classification.category || '').trim() }] })
        .populate('departmentId', 'name');
      if (mapping?.departmentId?._id) {
        resolvedDepartmentId = mapping.departmentId._id;
        resolvedDepartmentName = mapping.departmentId.name;
      } else if (resolvedDepartmentId) {
        const dep = await Department.findById(resolvedDepartmentId).select('name');
        if (dep) resolvedDepartmentName = dep.name;
      }
    } catch (e) {}
    if (!resolvedDepartmentId) {
      try {
        const dep = await Department.findOne({ isActive: true }).sort({ createdAt: 1 }).select('name');
        if (dep?._id) {
          resolvedDepartmentId = dep._id;
          resolvedDepartmentName = dep.name;
        }
      } catch (e) {}
    }

    const complaint = new Complaint({
      complaintId: complaintId,
      userId: req.user._id,
      category: classification.category,
      description: cleanedText,
      complaintText: cleanedText,
      location: {
        lat: parseFloat(location.lat),
        lng: parseFloat(location.lng),
        address: location.address || 'Address not specified',
        city: location.city || 'karachi'
      },
      status: 'pending',
      priority: classification.priority,
      priorityColor: classification.priority_color,
      modelConfidence: classification.confidence,
      departmentId: resolvedDepartmentId,
      department: resolvedDepartmentName
    });

    await complaint.save();

    // Create notification
    const notification = new Notification({
      recipient: req.user._id,
      recipientModel: 'User',
      title: 'Complaint Registered',
      message: `Your complaint ${complaint.complaintId} has been submitted successfully.`,
      type: 'success',
      relatedTo: 'complaint',
      relatedId: complaint._id
    });

    await notification.save();

    res.status(201).json({
      success: true,
      message: 'Complaint submitted successfully',
      complaint: {
        _id: complaint._id,
        complaintId: complaint.complaintId,
        category: complaint.category,
        status: complaint.status,
        createdAt: complaint.createdAt
      }
    });

  } catch (error) {
    console.error('Simple submit error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit complaint'
    });
  }
});

// Test ID generation
router.get('/test-id', async (req, res) => {
  try {
    const complaintId = await Complaint.generateComplaintId('water', 'karachi');
    res.json({
      success: true,
      complaintId,
      message: 'ID generation test successful'
    });
  } catch (error) {
    console.error('ID generation test error:', error);
    res.status(500).json({
      success: false,
      message: 'ID generation test failed'
    });
  }
});

// Dept Admin: create reroute request (requires Super Admin approval)
router.post('/:id/reroute-request', auth, authorize('dept-admin'), async (req, res) => {
  try {
    const { departmentId, reason } = req.body;
    if (!departmentId) {
      return res.status(400).json({ success: false, message: 'Target department is required' });
    }
    const comp = await Complaint.findById(req.params.id);
    if (!comp) return res.status(404).json({ success: false, message: 'Complaint not found' });
    // Restrict to admin's own department context
    const sameDept = (String(comp.departmentId||'') === String(req.user.departmentId||'')) || (String(comp.department||'').toLowerCase() === String(req.user.department||'').toLowerCase());
    if (!sameDept) return res.status(403).json({ success: false, message: 'Not allowed to reroute this complaint' });

    const normalizedStatus = String(comp.status || '').toLowerCase();
    if (normalizedStatus === 'resolved' || normalizedStatus === 'completed' || normalizedStatus === 'rejected') {
      return res.status(400).json({ success: false, message: 'Reroute not allowed after closure' });
    }
    if (comp.rerouteRequest && comp.rerouteRequest.status === 'pending') {
      return res.status(400).json({ success: false, message: 'A reroute request is already pending for this complaint' });
    }

    const dep = await Department.findById(departmentId).select('_id name');
    if (!dep) return res.status(404).json({ success: false, message: 'Target department not found' });

    comp.rerouteRequest = {
      status: 'pending',
      requestedBy: req.user._id,
      fromDepartmentId: comp.departmentId || undefined,
      proposedDepartmentId: dep._id,
      reason: reason || ''
    };
    comp.timeline.push({ type: 'reroute-request', message: 'Dept admin requested reroute', by: req.user._id, byRole: 'dept-admin', at: new Date(), meta: { proposedDepartmentId: departmentId } });
    await comp.save();

    // Notify super admins
    const supers = await SuperAdmin.find({}).select('_id');
    const notifs = supers.map(s => new Notification({ recipient: s._id, recipientModel: 'SuperAdmin', title: 'Reroute Request', message: `Complaint ${comp.complaintId} reroute request pending approval.`, type: 'info', relatedTo: 'complaint', relatedId: comp._id }));
    for (const n of notifs) { try { await n.save(); } catch(e){} }

    res.json({ success: true, complaint: { id: comp._id, rerouteRequest: comp.rerouteRequest } });
  } catch (e) {
    console.error('Create reroute request error:', e);
    res.status(500).json({ success: false, message: 'Failed to create reroute request' });
  }
});

module.exports = router;
