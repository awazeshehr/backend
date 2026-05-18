const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const Complaint = require('../models/Complaint');
const FieldOfficer = require('../models/FieldOfficer');
const User = require('../models/User');
const Notification = require('../models/Notification');
const DepartmentAdmin = require('../models/DepartmentAdmin');
const Department = require('../models/Department');
const SuperAdmin = require('../models/SuperAdmin');
const Message = require('../models/Message');
const AuditLog = require('../models/AuditLog');
const mongoose = require('mongoose');

function audit(req, action, entityType, entityId, payload) {
  try {
    AuditLog.create({
      actorId: req.user._id,
      actorRole: req.user.role,
      action,
      entityType,
      entityId,
      payload
    });
  } catch (e) {}
}

// Dashboard stats for department admin
router.get('/dept-admin', auth, authorize('dept-admin'), async (req, res) => {
  try {
    const user = req.user;
    
    console.log('Dept Admin Stats Request:', {
      userId: user._id,
      department: user.department,
      role: user.role
    });

    const deptFilter = user.departmentId
      ? { departmentId: user.departmentId }
      : { department: { $regex: new RegExp(`^${escapeRegExp(user.department)}$`, 'i') } };

    const complaints = await Complaint.find(deptFilter);
    
    // Debug active officers query
    const activeOfficersCount = await FieldOfficer.countDocuments({ 
      department: { $regex: new RegExp(user.department, 'i') },
      isActive: true 
    });

    
    // Calculate stats
    const stats = {
      totalComplaints: complaints.length,
      pendingComplaints: complaints.filter(c => c.status === 'pending').length,
      inProgressComplaints: complaints.filter(c => c.status === 'in-progress').length,
      resolvedComplaints: complaints.filter(c => c.status === 'resolved').length,
      completedComplaints: complaints.filter(c => c.status === 'completed').length,
      activeOfficers: activeOfficersCount,
      avgResolutionTime: calculateAvgResolutionTime(complaints),
      satisfactionRate: calculateSatisfactionRate(complaints)
    };
    
    
    res.json({ success: true, stats });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ success: false, message: 'Error fetching dashboard stats' });
  }
});

// Dashboard stats for field officer
router.get('/field-officer', auth, authorize('field-officer'), async (req, res) => {
  try {
    const userId = req.user._id;
    const totalAssigned = await Complaint.countDocuments({ assignedTo: userId });
    const pending = await Complaint.countDocuments({ assignedTo: userId, status: 'pending' });
    const inProgress = await Complaint.countDocuments({ assignedTo: userId, status: 'in-progress' });
    const resolved = await Complaint.countDocuments({ assignedTo: userId, status: 'resolved' });

    res.json({
      success: true,
      stats: {
        totalComplaints: totalAssigned,
        pendingComplaints: pending,
        inProgressComplaints: inProgress,
        resolvedComplaints: resolved
      }
    });
  } catch (error) {
    console.error('Error fetching field officer stats:', error);
    res.status(500).json({ success: false, message: 'Error fetching field officer stats' });
  }
});

// Dashboard stats for super admin
router.get('/super-admin', auth, authorize('super-admin'), async (req, res) => {
  try {
    const complaints = await Complaint.find({});
    const feedbacks = complaints
      .map(c => normalizeFeedbackForResponse(c.feedback))
      .filter(f => f && typeof f.sentiment === 'string' && typeof f.sentimentScore === 'number');

    const sentimentCounts = feedbacks.reduce((acc, f) => {
      const k = String(f.sentiment || '').toLowerCase();
      if (k === 'positive' || k === 'negative' || k === 'neutral') acc[k] += 1;
      return acc;
    }, { positive: 0, negative: 0, neutral: 0 });

    const feedbackTotal = feedbacks.length || 0;
    const avgCompound = feedbackTotal
      ? feedbacks.reduce((sum, f) => sum + (typeof f.sentimentScore === 'number' ? f.sentimentScore : 0), 0) / feedbackTotal
      : 0;

    const stats = {
      totalComplaints: complaints.length,
      pendingComplaints: complaints.filter(c => c.status === 'pending').length,
      inProgressComplaints: complaints.filter(c => c.status === 'in-progress').length,
      resolvedComplaints: complaints.filter(c => c.status === 'resolved').length,
      completedComplaints: complaints.filter(c => c.status === 'completed').length,
      activeOfficers: await FieldOfficer.countDocuments({ isActive: true }),
      avgResolutionTime: calculateAvgResolutionTime(complaints),
      satisfactionRate: calculateSatisfactionRate(complaints),
      feedbackAnalytics: {
        positivePercent: feedbackTotal ? Math.round((sentimentCounts.positive / feedbackTotal) * 100) : 0,
        negativePercent: feedbackTotal ? Math.round((sentimentCounts.negative / feedbackTotal) * 100) : 0,
        neutralPercent: feedbackTotal ? Math.round((sentimentCounts.neutral / feedbackTotal) * 100) : 0,
        overallSatisfactionScore: feedbackTotal ? Math.round(((avgCompound + 1) / 2) * 100) : 0
      }
    };
    res.json({ success: true, stats });
  } catch (error) {
    console.error('Error fetching super admin stats:', error);
    res.status(500).json({ success: false, message: 'Error fetching super admin stats' });
  }
});

function escapeRegExp(input) {
  return String(input || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeFeedbackForResponse(feedback) {
  if (!feedback) return null;

  const rating = Number(feedback.rating);
  const ratingMood = rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : 'neutral';
  const rawSentiment = String(feedback.sentiment || '').toLowerCase();
  let sentiment = rawSentiment === 'positive' || rawSentiment === 'negative' || rawSentiment === 'neutral' ? rawSentiment : 'neutral';
  let score = typeof feedback.sentimentScore === 'number' ? feedback.sentimentScore : 0;

  if (ratingMood !== 'neutral') {
    if (sentiment === 'neutral') sentiment = ratingMood;
    if (ratingMood === 'negative' && score > -0.2) score = -0.6;
    if (ratingMood === 'positive' && score < 0.2) score = 0.6;
  }

  return { ...feedback, sentiment, sentimentScore: score };
}

// Get complaints for department admin with filters
router.get('/complaints/dept-admin', auth, authorize('dept-admin'), async (req, res) => {
  try {
    const user = req.user;
    const { search, category, status, priority, officer, fromDate, toDate, area, region, overdueOnly } = req.query;
    
    
    const filter = {};
    if (user.departmentId) {
      filter.departmentId = user.departmentId;
    } else if (user.department) {
      filter.department = new RegExp(`^${escapeRegExp(user.department)}$`, 'i');
    }
    
    if (search) {
      filter.$or = [
        { complaintId: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (category && category !== 'all') {
      filter.category = category;
    }
    
    if (status && status !== 'all') {
      if (status === 'unassigned') {
        filter.$or = [
          { assignedTo: { $exists: false } },
          { assignedTo: null }
        ];
      } else {
        filter.status = status;
      }
    } else if (String(overdueOnly) === 'true') {
      filter.status = { $nin: ['resolved', 'completed'] };
    }
    
    if (priority && priority !== 'all') {
      filter.priority = priority;
    }
    
    if (officer && officer !== 'all') {
      filter.assignedTo = officer;
    }
    
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = new Date(fromDate);
      if (toDate) filter.createdAt.$lte = new Date(toDate);
    }
    
    if (area && area !== 'all') {
      filter['location.address'] = { $regex: area, $options: 'i' };
    }
    
    if (region && region !== 'all') {
      const regionRegex = { $regex: region, $options: 'i' };
      filter.$or = (filter.$or || []).concat([
        { 'location.address': regionRegex }
      ]);
    }
    
    if (String(overdueOnly) === 'true') {
      filter.dueDate = { $lt: new Date() };
    }

    const complaints = await Complaint.find(filter)
      .populate('assignedTo', 'fullName email')
      .populate('userId', 'fullName email phone')
      .sort({ createdAt: -1 });
    
    
    // Format complaints for frontend (similar to field officer)
      const formattedComplaints = complaints.map(complaint => ({
        _id: complaint._id,
        complaintId: complaint.complaintId,
        title: complaint.description.substring(0, 50) + (complaint.description.length > 50 ? '...' : ''),
        description: complaint.description,
        category: complaint.category,
        location: complaint.location?.address || 'Location not specified',
        status: complaint.status,
        priority: complaint.priority,
        priorityColor: complaint.priorityColor || '',
        modelConfidence: typeof complaint.modelConfidence === 'number' ? complaint.modelConfidence : undefined,
        dueDate: complaint.dueDate,
        feedback: normalizeFeedbackForResponse(complaint.feedback),
        citizenName: complaint.userId?.fullName || 'N/A',
        contactNumber: complaint.userId?.phone || 'N/A',
        assignedTo: complaint.assignedTo ? {
          _id: complaint.assignedTo._id,
          fullName: complaint.assignedTo.fullName,
          email: complaint.assignedTo.email
        } : null,
        assignedDate: complaint.assignedDate,
        createdAt: complaint.createdAt,
        updatedAt: complaint.updatedAt,
        media: complaint.media || [],
        evidence: complaint.evidence || [],
        timeline: complaint.timeline || []
      }));
    
    
    res.json({ success: true, complaints: formattedComplaints });
  } catch (error) {
    console.error('Error fetching complaints:', error);
    res.status(500).json({ success: false, message: 'Error fetching complaints' });
  }
});

// Get complaints for field officer
router.get('/complaints/field-officer', auth, authorize('field-officer'), async (req, res) => {
  try {
    const user = req.user;
    const assigned = await Complaint.find({ assignedTo: user._id })
      .populate('userId', 'fullName phone')
      .sort({ createdAt: -1 });
    const formatted = assigned.map(complaint => ({
      _id: complaint._id,
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
      evidence: complaint.evidence || []
    }));
    res.json({ success: true, complaints: formatted });
  } catch (error) {
    console.error('Error fetching field officer complaints:', error);
    res.status(500).json({ success: false, message: 'Error fetching field officer complaints' });
  }
});

// Get complaints for super admin
router.get('/complaints/super-admin', auth, authorize('super-admin'), async (req, res) => {
  try {
    const { search, status, category, priority } = req.query;
    const filter = {};
    if (search) {
      filter.$or = [
        { complaintId: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }
    if (status && status !== 'all') filter.status = status;
    if (category && category !== 'all') filter.category = category;
    if (priority && priority !== 'all') filter.priority = priority;

    const complaints = await Complaint.find(filter)
      .populate('assignedTo', 'fullName email')
      .populate('userId', 'fullName email phone')
      .sort({ createdAt: -1 });

    const formattedComplaints = complaints.map(complaint => ({
      _id: complaint._id,
      complaintId: complaint.complaintId,
      title: complaint.description.substring(0, 50) + (complaint.description.length > 50 ? '...' : ''),
      description: complaint.description,
      category: complaint.category,
      location: complaint.location?.address || 'Location not specified',
      status: complaint.status,
      priority: complaint.priority,
      citizenName: complaint.userId?.fullName || 'N/A',
      contactNumber: complaint.userId?.phone || 'N/A',
      assignedTo: complaint.assignedTo ? {
        _id: complaint.assignedTo._id,
        fullName: complaint.assignedTo.fullName,
        email: complaint.assignedTo.email
      } : null,
      assignedDate: complaint.assignedDate,
      createdAt: complaint.createdAt,
      updatedAt: complaint.updatedAt,
      media: complaint.media || [],
      evidence: complaint.evidence || [],
      timeline: complaint.timeline || []
    }));

    res.json({ success: true, complaints: formattedComplaints });
  } catch (error) {
    console.error('Error fetching super admin complaints:', error);
    res.status(500).json({ success: false, message: 'Error fetching super admin complaints' });
  }
});

router.post('/officers/dept-admin', auth, authorize('dept-admin'), async (req, res) => {
  try {
    const { fullName, email, password, wageType } = req.body;
    const admin = req.user;
    if (!fullName || !email || !password) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    if (!admin.department) {
      return res.status(400).json({ success: false, message: 'Admin department not configured' });
    }
    const existing = await FieldOfficer.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Field officer with this email already exists' });
    }

    const officer = new FieldOfficer({
      fullName,
      email,
      password,
      wageType: wageType || 'Monthly',
      department: admin.department
    });

    await officer.save();

    if (global.io) {
      global.io.emit('officerUpdate', { department: admin.department, officerId: officer._id });
    }

    res.status(201).json({
      success: true,
      officer: { id: officer._id, fullName: officer.fullName, email: officer.email, department: officer.department }
    });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(400).json({ success: false, message: 'Email already in use' });
    }
    if (error && error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(e => e.message);
      return res.status(400).json({ success: false, message: messages.join(' • ') });
    }
    console.error('Error creating field officer:', error);
    res.status(500).json({ success: false, message: error?.message || 'Error creating field officer' });
  }
});

// Get officers for department admin
router.get('/officers/dept-admin', auth, authorize('dept-admin'), async (req, res) => {
  try {
    const user = req.user;
    
    
    // First check all field officers in database
    const allOfficers = await FieldOfficer.find({}).select('fullName email department isActive');
    
    // Get field officers for the admin's department only
    const officers = await FieldOfficer.find({ isActive: true, department: user.department })
      .select('fullName email isActive currentLocation department wageType');
    
    
    // Add complaint stats for each officer (from ALL categories, not just admin's department)
    const officersWithStats = await Promise.all(
      officers.map(async (officer) => {
        const activeComplaints = await Complaint.countDocuments({
          assignedTo: officer._id,
          status: { $in: ['in-progress', 'pending'] }
        });

        const resolvedThisMonth = await Complaint.countDocuments({
          assignedTo: officer._id,
          status: 'resolved',
          updatedAt: {
            $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
          }
        });

        const avgResolutionTime = await calculateOfficerAvgResolutionTime(officer._id);

        return {
          _id: officer._id,
          fullName: officer.fullName,
          email: officer.email,
          department: officer.department,
          isActive: officer.isActive,
          currentLocation: officer.currentLocation,
          activeComplaints,
          resolvedThisMonth,
          avgResolutionTime
        };
      })
    );
    
    res.json({ success: true, officers: officersWithStats });
  } catch (error) {
    console.error('Error fetching officers:', error);
    res.status(500).json({ success: false, message: 'Error fetching officers' });
  }
});

// Get map data for department admin
router.get('/map/dept-admin', auth, authorize('dept-admin'), async (req, res) => {
  try {
    const user = req.user;
    
    const deptFilter = user.departmentId
      ? { departmentId: user.departmentId }
      : { department: { $regex: new RegExp(`^${escapeRegExp(user.department)}$`, 'i') } };
    
    const complaints = await Complaint.find({ ...deptFilter, location: { $exists: true } })
      .select('complaintId category status priority location createdAt');
    
    // Get officers with current locations
    const officers = await FieldOfficer.find({
      department: { $regex: new RegExp(user.department, 'i') },
      'currentLocation.lat': { $exists: true }
    }).select('fullName currentLocation');
    
    res.json({ success: true, complaints, officers });
  } catch (error) {
    console.error('Error fetching map data:', error);
    res.status(500).json({ success: false, message: 'Error fetching map data' });
  }
});

// Get pending verifications
router.get('/verification/pending', auth, authorize('dept-admin'), async (req, res) => {
  try {
    const user = req.user;
    
    const deptFilter = user.departmentId
      ? { departmentId: user.departmentId }
      : { department: { $regex: new RegExp(`^${escapeRegExp(user.department)}$`, 'i') } };

    const complaints = await Complaint.find({
      ...deptFilter,
      status: 'resolved',
      verified: { $ne: true }
    })
      .populate('assignedTo', 'fullName')
      .populate('citizen', 'fullName contactNumber')
      .sort({ updatedAt: -1 });
    
    res.json({ success: true, complaints });
  } catch (error) {
    console.error('Error fetching pending verifications:', error);
    res.status(500).json({ success: false, message: 'Error fetching pending verifications' });
  }
});

// Get messages for department admin
router.get('/messages/dept-admin', auth, authorize('dept-admin'), async (req, res) => {
  try {
    const user = req.user;
    
    const messages = await Message.find({
      $or: [
        { senderId: user._id },
        { recipientId: user._id }
      ]
    })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
    
    const formattedMessages = await Promise.all(messages.map(async (msg) => {
      const isSender = msg.senderId.toString() === user._id.toString();
      const otherId = isSender ? msg.recipientId : msg.senderId;
      
      let title = 'Unknown User';
      let otherUser = await User.findById(otherId).select('fullName');
      
      if (otherUser) {
        title = otherUser.fullName;
      } else {
        otherUser = await FieldOfficer.findById(otherId).select('fullName');
        if (otherUser) {
          title = `${otherUser.fullName} (Field Officer)`;
        } else {
           otherUser = await DepartmentAdmin.findById(otherId).select('fullName');
           if (otherUser) {
             title = `${otherUser.fullName} (Admin)`;
           }
        }
      }
      
      return {
        _id: msg._id,
        title: isSender ? `To: ${title}` : `From: ${title}`,
        message: msg.text,
        type: 'message',
        createdAt: msg.createdAt,
        senderId: isSender ? null : otherId,
        read: true
      };
    }));
    
    res.json({ success: true, messages: formattedMessages });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ success: false, message: 'Error fetching messages' });
  }
});

// Get reports data for department admin
router.get('/reports/dept-admin', auth, authorize('dept-admin'), async (req, res) => {
  try {
    const user = req.user;
    const { fromDate, toDate, category } = req.query;
    
    const deptFilter = user.departmentId
      ? { departmentId: user.departmentId }
      : { department: { $regex: new RegExp(`^${escapeRegExp(user.department)}$`, 'i') } };

    const filter = { ...deptFilter };
    
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = new Date(fromDate);
      if (toDate) filter.createdAt.$lte = new Date(toDate);
    }
    
    if (category && category !== 'all') {
      filter.category = category;
    }
    
    const complaints = await Complaint.find(filter)
      .populate('assignedTo', 'fullName')
      .populate('citizen', 'fullName')
      .sort({ createdAt: -1 });
    
    // Generate report data
    const reportData = {
      totalComplaints: complaints.length,
      complaintsByCategory: getComplaintsByCategory(complaints),
      complaintsByStatus: getComplaintsByStatus(complaints),
      complaintsByMonth: getComplaintsByMonth(complaints),
      topOfficers: getTopOfficers(complaints),
      avgResolutionTime: calculateAvgResolutionTime(complaints),
      satisfactionRate: calculateSatisfactionRate(complaints)
    };
    
    res.json({ success: true, reportData });
  } catch (error) {
    console.error('Error fetching reports:', error);
    res.status(500).json({ success: false, message: 'Error fetching reports' });
  }
});

// Assign officer to complaint
router.post('/complaints/:id/assign', auth, authorize('dept-admin'), async (req, res) => {
  try {
    const { officerId } = req.body;
    const complaintId = req.params.id;
    const user = req.user;
    
    console.log('🔍 Assignment API - User Department:', user.department);
    console.log('🔍 Assignment API - Officer ID:', officerId);
    console.log('🔍 Assignment API - Complaint ID:', complaintId);
    
    const deptFilter = user.departmentId
      ? { departmentId: user.departmentId }
      : { department: { $regex: new RegExp(`^${escapeRegExp(user.department)}$`, 'i') } };

    const complaint = await Complaint.findOne({
      _id: complaintId,
      ...deptFilter
    }).populate('userId', 'fullName email');
    
    if (!complaint) {
      console.log('❌ Complaint not found for department:', user.departmentId || user.department);
      return res.status(404).json({ success: false, message: 'Complaint not found' });
    }
    
    // Verify officer exists and belongs to same department
    const officer = await FieldOfficer.findOne({
      _id: officerId,
      isActive: true
    }).select('fullName email department');
    
    if (!officer) {
      console.log('❌ Officer not found or inactive:', officerId);
      return res.status(404).json({ success: false, message: 'Officer not found or inactive' });
    }
    
    // Enforce same department
    const sameDept = String(officer.department || '').toLowerCase() === String(user.department || '').toLowerCase();
    if (!sameDept) {
      return res.status(403).json({ success: false, message: 'Officer does not belong to your department' });
    }
    
    console.log('✅ Found complaint:', complaint.complaintId);
    console.log('✅ Found officer:', officer.fullName);
    
    // Update complaint
    complaint.assignedTo = officer._id;
    complaint.status = 'in-progress';
    complaint.assignedDate = new Date();
    
    // Add timeline entry
    complaint.timeline = complaint.timeline || [];
    complaint.timeline.push({
      type: 'assigned',
      message: `Complaint assigned to ${officer.fullName}`,
      by: user._id,
      byRole: user.role,
      at: new Date(),
      meta: { officerId }
    });
    
    await complaint.save();
    
    const shortDescription = String(complaint.description || '').substring(0, 50);

    // Create notification for the field officer
    const officerNotification = new Notification({
      userId: officer._id,
      recipient: officer._id,
      recipientModel: 'FieldOfficer',
      title: 'New Complaint Assigned',
      message: `You have been assigned complaint ${complaint.complaintId} (${complaint.category}) - ${shortDescription}${shortDescription.length === 50 ? '...' : ''}`,
      type: 'info',
      relatedTo: 'complaint',
      relatedId: complaint._id
    });
    
    await officerNotification.save();
    
    // Create notification for the citizen
    const citizenNotification = new Notification({
      userId: complaint.userId._id,
      recipient: complaint.userId._id,
      recipientModel: 'User',
      title: 'Complaint Assigned',
      message: `Your complaint ${complaint.complaintId} has been assigned to ${officer.fullName} (${officer.department}). They will contact you soon.`,
      type: 'info',
      relatedTo: 'complaint',
      relatedId: complaint._id
    });
    
    await citizenNotification.save();
    audit(req, 'assign-officer', 'complaint', complaint._id, { officerId });
    
    console.log('✅ Officer assigned successfully');
    
    res.json({ success: true, message: 'Officer assigned successfully' });
  } catch (error) {
    console.error('Error assigning officer:', error);
    res.status(500).json({ success: false, message: 'Error assigning officer' });
  }
});

router.get('/officers/dept-admin/available', auth, authorize('dept-admin'), async (req, res) => {
  try {
    const { complaintId } = req.query;
    const user = req.user;
    if (!complaintId) {
      return res.status(400).json({ success: false, message: 'complaintId is required' });
    }
    const adminDept = (user.department || '').toLowerCase();
    const complaint = await Complaint.findById(complaintId).select('category');
    if (!complaint) {
      return res.status(404).json({ success: false, message: 'Complaint not found' });
    }
    const q = {
      isActive: true,
      department: { $regex: new RegExp(user.department, 'i') }
    };
    const officers = await FieldOfficer.find(q).select('_id fullName email department isActive');
    const results = [];
    for (const o of officers) {
      const totalAssigned = await Complaint.countDocuments({ assignedTo: o._id, status: { $in: ['pending', 'under-review', 'in-progress'] } });
      const inProgress = await Complaint.countDocuments({ assignedTo: o._id, status: 'in-progress' });
      const resolved = await Complaint.countDocuments({ assignedTo: o._id, status: 'resolved' });
      const availability = o.isActive ? (inProgress < 5 ? 'available' : 'busy') : 'inactive';
      results.push({
        _id: o._id,
        fullName: o.fullName,
        email: o.email,
        department: o.department,
        isActive: o.isActive,
        totalAssigned,
        inProgress,
        resolved,
        specialization: o.specialization || null,
        availability
      });
    }
    res.json({ success: true, officers: results });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching available officers' });
  }
});

// Update complaint priority
router.put('/complaints/:id/priority', auth, authorize('dept-admin'), async (req, res) => {
  try {
    const { priority } = req.body;
    const complaintId = req.params.id;
    const user = req.user;
    
    console.log('🔍 Priority Update API - User Department:', user.department);
    console.log('🔍 Priority Update API - Priority:', priority);
    console.log('🔍 Priority Update API - Complaint ID:', complaintId);
    
    const deptFilter = user.departmentId
      ? { departmentId: user.departmentId }
      : { department: { $regex: new RegExp(`^${escapeRegExp(user.department)}$`, 'i') } };

    const complaint = await Complaint.findOne({
      _id: complaintId,
      ...deptFilter
    });
    
    if (!complaint) {
      console.log('❌ Complaint not found for department:', user.departmentId || user.department);
      return res.status(404).json({ success: false, message: 'Complaint not found' });
    }
    
    console.log('✅ Found complaint for priority update:', complaint.complaintId);
    
    complaint.priority = priority;
    
    // Add timeline entry
    complaint.timeline = complaint.timeline || [];
    complaint.timeline.push({
      type: 'priority-changed',
      message: `Priority changed to ${priority}`,
      by: user._id,
      byRole: user.role,
      at: new Date(),
      meta: { priority }
    });
    
    await complaint.save();
    audit(req, 'update-priority', 'complaint', complaint._id, { priority });
    
    console.log('✅ Priority updated successfully');
    
    res.json({ success: true, message: 'Priority updated successfully' });
  } catch (error) {
    console.error('Error updating priority:', error);
    res.status(500).json({ success: false, message: 'Error updating priority' });
  }
});

router.put('/complaints/:id/due-date', auth, authorize('dept-admin'), async (req, res) => {
  try {
    const { dueDate } = req.body;
    const user = req.user;
    const deptFilter = user.departmentId
      ? { departmentId: user.departmentId }
      : { department: { $regex: new RegExp(`^${escapeRegExp(user.department)}$`, 'i') } };
    const complaint = await Complaint.findOne({ _id: req.params.id, ...deptFilter });
    if (!complaint) {
      return res.status(404).json({ success: false, message: 'Complaint not found' });
    }
    complaint.dueDate = dueDate ? new Date(dueDate) : null;
    complaint.timeline = complaint.timeline || [];
    complaint.timeline.push({ type: 'due-date-set', message: 'Due date updated', by: user._id, byRole: user.role, at: new Date(), meta: { dueDate: complaint.dueDate } });
    await complaint.save();
    audit(req, 'update-due-date', 'complaint', complaint._id, { dueDate: complaint.dueDate });
    res.json({ success: true, message: 'Due date updated', dueDate: complaint.dueDate });
  } catch (error) {
    console.error('Error updating due date:', error);
    res.status(500).json({ success: false, message: 'Error updating due date' });
  }
});

router.put('/complaints/:id/reroute', auth, authorize('dept-admin'), async (req, res) => {
  try {
    const { departmentId, reason } = req.body || {};
    const user = req.user;
    if (!departmentId) {
      return res.status(400).json({ success: false, message: 'Target department is required' });
    }
    const deptFilter = user.departmentId
      ? { departmentId: user.departmentId }
      : { department: { $regex: new RegExp(`^${escapeRegExp(user.department)}$`, 'i') } };

    const complaint = await Complaint.findOne({ _id: req.params.id, ...deptFilter });
    if (!complaint) {
      return res.status(404).json({ success: false, message: 'Complaint not found' });
    }

    const normalizedStatus = String(complaint.status || '').toLowerCase();
    if (normalizedStatus === 'resolved' || normalizedStatus === 'completed' || normalizedStatus === 'rejected') {
      return res.status(400).json({ success: false, message: 'Reroute not allowed after closure' });
    }
    if (complaint.rerouteRequest && complaint.rerouteRequest.status === 'pending') {
      return res.status(400).json({ success: false, message: 'A reroute request is already pending for this complaint' });
    }

    const targetDepartment = await Department.findById(departmentId).select('_id name');
    if (!targetDepartment) {
      return res.status(404).json({ success: false, message: 'Target department not found' });
    }

    complaint.timeline = complaint.timeline || [];
    complaint.timeline.push({
      type: 'reroute-request',
      message: 'Dept admin requested reroute',
      by: user._id,
      byRole: user.role,
      at: new Date(),
      meta: { proposedDepartmentId: targetDepartment._id, reason: reason || undefined }
    });

    complaint.rerouteRequest = {
      status: 'pending',
      requestedBy: user._id,
      fromDepartmentId: complaint.departmentId || undefined,
      proposedDepartmentId: targetDepartment._id,
      reason: reason || ''
    };

    await complaint.save();
    audit(req, 'reroute-request', 'complaint', complaint._id, { proposedDepartmentId: targetDepartment._id, reason: reason || undefined });

    try {
      const supers = await SuperAdmin.find({}).select('_id');
      for (const s of supers) {
        try {
          const notification = new Notification({
            recipient: s._id,
            recipientModel: 'SuperAdmin',
            title: 'Reroute Request',
            message: `Complaint ${complaint.complaintId} reroute request pending approval.`,
            type: 'info',
            relatedTo: 'complaint',
            relatedId: complaint._id
          });
          await notification.save();
        } catch (e) {}
      }
    } catch (e) {}

    if (global.io) {
      global.io.emit('complaintUpdate', { complaintId: complaint._id, status: complaint.status, department: complaint.department });
    }

    res.json({ success: true, message: 'Reroute request submitted for Super Admin approval' });
  } catch (error) {
    console.error('Error rerouting complaint:', error);
    res.status(500).json({ success: false, message: 'Error rerouting complaint' });
  }
});

// Verify complaint (approve completion)
router.put('/complaints/:id/verify', auth, authorize('dept-admin'), async (req, res) => {
  try {
    const { verified } = req.body;
    const complaintId = req.params.id;
    const user = req.user;
    
    console.log('🔍 Verification API - User Department:', user.department);
    console.log('🔍 Verification API - Verified:', verified);
    console.log('🔍 Verification API - Complaint ID:', complaintId);
    
    const deptFilter = user.departmentId
      ? { departmentId: user.departmentId }
      : { department: { $regex: new RegExp(`^${escapeRegExp(user.department)}$`, 'i') } };

    const complaint = await Complaint.findOne({
      _id: complaintId,
      ...deptFilter
    }).populate('userId', 'fullName email').populate('assignedTo', 'fullName email');
    
    if (!complaint) {
      console.log('❌ Complaint not found for department:', user.departmentId || user.department);
      return res.status(404).json({ success: false, message: 'Complaint not found' });
    }
    
    console.log('✅ Found complaint for verification:', complaint.complaintId);
    
    if (verified) {
      // Approve the complaint - mark as completed
      complaint.status = 'completed';
      complaint.resolvedAt = new Date();
      complaint.verified = true;
      complaint.verifiedBy = user._id;
      complaint.verifiedAt = new Date();
      
      // Add timeline entry
      complaint.timeline = complaint.timeline || [];
      complaint.timeline.push({
        type: 'verified',
        message: `Complaint verified and completed by ${user.fullName}`,
        by: user._id,
        byRole: user.role,
        at: new Date(),
        meta: { verified: true }
      });
      
      // Save complaint first
      await complaint.save();
      
      // Create notification for the citizen
      const citizenNotification = new Notification({
        recipient: complaint.userId._id,
        recipientModel: 'User',
        title: 'Complaint Resolved Successfully!',
        message: `Great news! Your complaint ${complaint.complaintId} has been successfully resolved and verified. Thank you for your patience.`,
        type: 'success',
        relatedTo: 'complaint',
        relatedId: complaint._id
      });
      
      await citizenNotification.save();
      
      // Create notification for the assigned officer
      if (complaint.assignedTo) {
        const officerNotification = new Notification({
          recipient: complaint.assignedTo._id,
          recipientModel: 'FieldOfficer',
          title: 'Complaint Completed Successfully!',
          message: `Excellent work! Your complaint ${complaint.complaintId} has been verified and completed by the department admin.`,
          type: 'success',
          relatedTo: 'complaint',
          relatedId: complaint._id
        });
        
        await officerNotification.save();
        
        // Emit socket event to field officer
        if (global.io) {
          global.io.emit('notificationUpdate', {
            userId: complaint.assignedTo._id,
            notification: officerNotification
          });
        }
      }
      
      // Emit socket event to citizen
      if (global.io) {
        global.io.emit('notificationUpdate', {
          userId: complaint.userId._id,
          notification: citizenNotification
        });
        
        // Emit complaint update event
        global.io.emit('complaintUpdate', {
          complaintId: complaint._id,
          status: 'completed',
          department: user.department
        });
      }
      
      console.log('✅ Complaint verified and completed successfully');
    } else {
      // Reject the complaint - mark as in-progress for rework
      complaint.status = 'in-progress';
      
      // Add timeline entry
      complaint.timeline = complaint.timeline || [];
      complaint.timeline.push({
        type: 'verification-rejected',
        message: `Complaint verification rejected by ${user.fullName}. Requires additional work.`,
        by: user._id,
        byRole: user.role,
        at: new Date(),
        meta: { verified: false }
      });
      
      await complaint.save();
      
      // Create notification for the assigned officer
      if (complaint.assignedTo) {
        const officerNotification = new Notification({
          recipient: complaint.assignedTo._id,
          recipientModel: 'FieldOfficer',
          title: 'Complaint Requires Additional Work',
          message: `The complaint ${complaint.complaintId} has been rejected during verification. Please review and provide additional evidence or complete the work.`,
          type: 'warning',
          relatedTo: 'complaint',
          relatedId: complaint._id
        });
        
        await officerNotification.save();
        
        // Emit socket event to field officer
        if (global.io) {
          global.io.emit('notificationUpdate', {
            userId: complaint.assignedTo._id,
            notification: officerNotification
          });
          
          global.io.emit('complaintUpdate', {
            complaintId: complaint._id,
            status: 'in-progress',
            department: user.department
          });
        }
      }
      
      console.log('✅ Complaint verification rejected');
    }
    
    res.json({ success: true, message: verified ? 'Complaint verified successfully' : 'Complaint verification rejected' });
  } catch (error) {
    console.error('Error verifying complaint:', error);
    res.status(500).json({ success: false, message: 'Error verifying complaint' });
  }
});

// Mark complaint under review
router.put('/complaints/:id/review', auth, authorize('dept-admin'), async (req, res) => {
  try {
    const complaintId = req.params.id;
    const user = req.user;
    
    const complaint = await Complaint.findOne({
      _id: complaintId,
      department: user.department
    });
    
    if (!complaint) {
      return res.status(404).json({ success: false, message: 'Complaint not found' });
    }
    
    complaint.status = 'under-review';
    
    // Add timeline entry
    complaint.timeline = complaint.timeline || [];
    complaint.timeline.push({
      type: 'status-changed',
      message: 'Complaint marked under review',
      by: user._id,
      byRole: user.role,
      at: new Date(),
      meta: { status: 'under-review' }
    });
    
    await complaint.save();
    audit(req, 'update-status', 'complaint', complaint._id, { status: 'under-review' });
    
    res.json({ success: true, message: 'Complaint marked under review' });
  } catch (error) {
    console.error('Error marking under review:', error);
    res.status(500).json({ success: false, message: 'Error marking under review' });
  }
});

// Update complaint status
router.put('/complaints/:id/status', auth, authorize('dept-admin'), async (req, res) => {
  try {
    const { status, comments } = req.body;
    const complaintId = req.params.id;
    const user = req.user;
    
    const complaint = await Complaint.findOne({
      _id: complaintId,
      department: user.department
    });
    
    if (!complaint) {
      return res.status(404).json({ success: false, message: 'Complaint not found' });
    }
    
    const allowedStatuses = ['under-review', 'in-progress'];
    if (!allowedStatuses.includes(status)) {
      return res.status(403).json({ success: false, message: 'Status update not permitted for department admin' });
    }
    complaint.status = status;
    if (comments) {
      complaint.adminComments = comments;
    }
    
    // Add timeline entry
    complaint.timeline = complaint.timeline || [];
    complaint.timeline.push({
      type: 'status-changed',
      message: `Status changed to ${status} by admin`,
      by: user._id,
      byRole: user.role,
      at: new Date(),
      meta: { status, comments }
    });
    
    await complaint.save();
    audit(req, 'update-status', 'complaint', complaint._id, { status, comments });
    
    res.json({ success: true, message: 'Status updated successfully' });
  } catch (error) {
    console.error('Error updating status:', error);
    res.status(500).json({ success: false, message: 'Error updating status' });
  }
});

// Get single complaint for department admin
router.get('/complaints/:id', auth, authorize('dept-admin'), async (req, res) => {
  try {
    const complaintId = req.params.id;
    const user = req.user;
    
    const complaint = await Complaint.findOne({
      _id: complaintId,
      department: user.department
    })
      .populate('assignedTo', 'fullName email')
      .populate('citizen', 'fullName email contactNumber')
      .populate('timeline.by', 'fullName');
    
    if (!complaint) {
      return res.status(404).json({ success: false, message: 'Complaint not found' });
    }
    
    res.json({ success: true, complaint });
  } catch (error) {
    console.error('Error fetching complaint:', error);
    res.status(500).json({ success: false, message: 'Error fetching complaint' });
  }
});

// Escalate complaint to super admin
router.post('/complaints/:id/escalate', auth, async (req, res) => {
  try {
    const { reason } = req.body;
    const complaintId = req.params.id;
    const user = req.user;
    
    const complaint = await Complaint.findOne({
      _id: complaintId,
      department: user.department
    });
    
    if (!complaint) {
      return res.status(404).json({ success: false, message: 'Complaint not found' });
    }
    
    complaint.escalated = true;
    complaint.escalatedBy = user._id;
    complaint.escalatedAt = new Date();
    complaint.escalationReason = reason;
    
    // Add timeline entry
    complaint.timeline = complaint.timeline || [];
    complaint.timeline.push({
      type: 'escalated',
      message: `Complaint escalated to Super Admin: ${reason}`,
      by: user._id,
      byRole: user.role,
      at: new Date(),
      meta: { reason }
    });
    
    await complaint.save();
    
    res.json({ success: true, message: 'Complaint escalated successfully' });
  } catch (error) {
    console.error('Error escalating complaint:', error);
    res.status(500).json({ success: false, message: 'Error escalating complaint' });
  }
});

// Helper functions
function calculateAvgResolutionTime(complaints) {
  const resolvedComplaints = complaints.filter(c => c.status === 'resolved' && c.resolvedAt);
  if (resolvedComplaints.length === 0) return 0;
  
  const totalTime = resolvedComplaints.reduce((sum, complaint) => {
    const resolutionTime = (complaint.resolvedAt - complaint.createdAt) / (1000 * 60 * 60); // hours
    return sum + resolutionTime;
  }, 0);
  
  return Math.round(totalTime / resolvedComplaints.length);
}

function calculateSatisfactionRate(complaints) {
  const complaintsWithFeedback = complaints.filter(c => c.feedback && c.feedback.rating);
  if (complaintsWithFeedback.length === 0) return 0;
  
  const avgRating = complaintsWithFeedback.reduce((sum, complaint) => {
    return sum + complaint.feedback.rating;
  }, 0) / complaintsWithFeedback.length;
  
  return Math.round((avgRating / 5) * 100);
}

async function calculateOfficerAvgResolutionTime(officerId) {
  const resolvedComplaints = await Complaint.find({
    assignedTo: officerId,
    status: 'resolved',
    resolvedAt: { $exists: true }
  });
  
  if (resolvedComplaints.length === 0) return 0;
  
  const totalTime = resolvedComplaints.reduce((sum, complaint) => {
    const resolutionTime = (complaint.resolvedAt - complaint.createdAt) / (1000 * 60 * 60); // hours
    return sum + resolutionTime;
  }, 0);
  
  return Math.round(totalTime / resolvedComplaints.length);
}

function getComplaintsByCategory(complaints) {
  const categories = {};
  complaints.forEach(complaint => {
    categories[complaint.category] = (categories[complaint.category] || 0) + 1;
  });
  return categories;
}

function getComplaintsByStatus(complaints) {
  const statuses = {};
  complaints.forEach(complaint => {
    statuses[complaint.status] = (statuses[complaint.status] || 0) + 1;
  });
  return statuses;
}

function getComplaintsByMonth(complaints) {
  const months = {};
  complaints.forEach(complaint => {
    const month = complaint.createdAt.toISOString().substring(0, 7); // YYYY-MM
    months[month] = (months[month] || 0) + 1;
  });
  return months;
}

function getTopOfficers(complaints) {
  const officerStats = {};
  complaints.forEach(complaint => {
    if (complaint.assignedTo) {
      const officerId = complaint.assignedTo._id || complaint.assignedTo;
      if (!officerStats[officerId]) {
        officerStats[officerId] = {
          name: complaint.assignedTo.fullName || 'Unknown',
          resolved: 0,
          total: 0
        };
      }
      officerStats[officerId].total++;
      if (complaint.status === 'resolved') {
        officerStats[officerId].resolved++;
      }
    }
  });
  
  return Object.values(officerStats)
    .sort((a, b) => b.resolved - a.resolved)
    .slice(0, 5);
}

// Get department admin for field officer
router.get('/field-officer/admin', auth, authorize('field-officer'), async (req, res) => {
  try {
    const officer = await FieldOfficer.findById(req.user._id);
    if (!officer) return res.status(404).json({ success: false, message: 'Officer not found' });

    // Find admin with matching department (case-insensitive)
    const admin = await DepartmentAdmin.findOne({
      department: { $regex: new RegExp(`^${officer.department}$`, 'i') }
    }).select('_id fullName email department');

    if (!admin) return res.status(404).json({ success: false, message: 'Department admin not found' });

    res.json({ success: true, admin });
  } catch (err) {
    console.error('Error fetching department admin:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get recent messages for department admin
router.get('/messages/dept-admin', auth, authorize('dept-admin'), async (req, res) => {
  try {
    const user = req.user;
    
    // Find messages where user is sender or recipient
    const messages = await Message.find({
      $or: [
        { senderId: user._id },
        { recipientId: user._id }
      ]
    })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

    // Map messages to notifications format for the frontend
    // We need to fetch sender/recipient names manually since they are in different collections
    const formattedMessages = await Promise.all(messages.map(async (msg) => {
      const isSender = msg.senderId.toString() === user._id.toString();
      const otherId = isSender ? msg.recipientId : msg.senderId;
      const otherRole = isSender ? 'user' : msg.senderRole; // Simplified, assuming recipient is user/officer
      
      // Try to find name of the other person
      let title = 'Unknown User';
      
      // Try finding in User (Citizen)
      let otherUser = await User.findById(otherId).select('fullName');
      if (otherUser) {
        title = otherUser.fullName;
      } else {
        // Try Field Officer
        otherUser = await FieldOfficer.findById(otherId).select('fullName');
        if (otherUser) {
          title = `${otherUser.fullName} (Field Officer)`;
        } else {
           // Try Department Admin (another admin)
           otherUser = await DepartmentAdmin.findById(otherId).select('fullName');
           if (otherUser) {
             title = `${otherUser.fullName} (Admin)`;
           }
        }
      }

      return {
        _id: msg._id,
        title: isSender ? `To: ${title}` : `From: ${title}`,
        message: msg.text,
        type: 'message',
        createdAt: msg.createdAt,
        read: false // Default
      };
    }));

    res.json({ success: true, messages: formattedMessages });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ success: false, message: 'Error fetching messages' });
  }
});

module.exports = router;
