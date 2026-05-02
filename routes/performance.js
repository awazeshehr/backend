const express = require('express');
const Complaint = require('../models/Complaint');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const router = express.Router();

// Get field officer performance
router.get('/field-officer', auth, authorize('field-officer'), async (req, res) => {
  try {
    // Check if user is field officer
    if (req.user.role !== 'field-officer') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Field officer only.'
      });
    }

    const userId = req.user._id;
    
    const totalAssigned = await Complaint.countDocuments({ assignedTo: userId });
    const resolved = await Complaint.countDocuments({ 
      assignedTo: userId, 
      status: 'resolved' 
    });
    const pending = await Complaint.countDocuments({ 
      assignedTo: userId, 
      status: 'pending' 
    });
    const inProgress = await Complaint.countDocuments({ 
      assignedTo: userId, 
      status: 'in-progress' 
    });
    
    // Calculate average resolution time (in days)
    const resolvedComplaints = await Complaint.find({
      assignedTo: userId,
      status: 'resolved',
      resolvedAt: { $exists: true },
      assignedDate: { $exists: true }
    });
    
    let totalResolutionTime = 0;
    resolvedComplaints.forEach(complaint => {
      const resolutionTime = (complaint.resolvedAt - complaint.assignedDate) / (1000 * 60 * 60 * 24);
      totalResolutionTime += resolutionTime;
    });
    
    const avgResolutionTime = resolved > 0 ? (totalResolutionTime / resolved).toFixed(1) : 0;

    // Recent resolved complaints for history
    const recentResolved = await Complaint.find({
      assignedTo: userId,
      status: 'resolved'
    })
    .populate('userId', 'fullName')
    .sort({ resolvedAt: -1 })
    .limit(5);

    res.json({
      success: true,
      performance: {
        totalAssigned,
        resolved,
        pending,
        inProgress,
        avgResolutionTime,
        recentResolved: recentResolved.map(comp => ({
          id: comp._id,
          complaintId: comp.complaintId,
          category: comp.category,
          assignedDate: comp.assignedDate,
          resolvedAt: comp.resolvedAt,
          resolutionTime: comp.resolvedAt && comp.assignedDate ? 
            Math.ceil((comp.resolvedAt - comp.assignedDate) / (1000 * 60 * 60 * 24)) : 0,
          citizenName: comp.userId?.fullName || 'N/A'
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching performance data:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching performance data'
    });
  }
});

module.exports = router;
