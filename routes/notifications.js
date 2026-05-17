const express = require('express');
const Notification = require('../models/Notification');
const auth = require('../middleware/auth');
const router = express.Router();

// Helper to map role to model name
const getRecipientModel = (role) => {
  switch (role) {
    case 'citizen': return 'User';
    case 'field-officer': return 'FieldOfficer';
    case 'dept-admin': return 'DepartmentAdmin';
    case 'super-admin': return 'SuperAdmin';
    default: return 'User';
  }
};

// Get user notifications
router.get('/', auth, async (req, res) => {
  try {
    const recipientModel = getRecipientModel(req.user.role);
    
    // Support both new schema (recipient+recipientModel) and legacy (userId)
    const query = {
      $or: [
        { recipient: req.user._id, recipientModel },
        { userId: req.user._id }
      ]
    };

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({
      success: true,
      notifications: notifications.map(notif => ({
        id: notif._id,
        title: notif.title,
        message: notif.message,
        type: notif.type,
        icon: getNotificationIcon(notif.type),
        isRead: notif.isRead,
        timestamp: notif.createdAt,
        createdAt: notif.createdAt,
        relatedTo: notif.relatedTo,
        relatedId: notif.relatedId
      }))
    });

  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching notifications'
    });
  }
});

// Mark notification as read
router.patch('/:id/read', auth, async (req, res) => {
  try {
    const recipientModel = getRecipientModel(req.user.role);
    
    const notification = await Notification.findOneAndUpdate(
      { 
        _id: req.params.id,
        $or: [
          { recipient: req.user._id },
          { userId: req.user._id }
        ]
      },
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.json({
      success: true,
      message: 'Notification marked as read'
    });

  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating notification'
    });
  }
});

// Mark all notifications as read
router.patch('/read-all', auth, async (req, res) => {
  try {
    const recipientModel = getRecipientModel(req.user.role);
    
    await Notification.updateMany(
      { 
        $or: [
          { recipient: req.user._id, recipientModel },
          { userId: req.user._id }
        ],
        isRead: false 
      },
      { isRead: true }
    );

    res.json({
      success: true,
      message: 'All notifications marked as read'
    });

  } catch (error) {
    console.error('Mark all notifications read error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating notifications'
    });
  }
});

// Get unread notification count
router.get('/unread-count', auth, async (req, res) => {
  try {
    const recipientModel = getRecipientModel(req.user.role);
    
    const count = await Notification.countDocuments({
      $or: [
        { recipient: req.user._id, recipientModel },
        { userId: req.user._id }
      ],
      isRead: false
    });

    res.json({
      success: true,
      count
    });

  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Helper function to get appropriate icons
function getNotificationIcon(type) {
  const iconMap = {
    'success': 'fa-check-circle',
    'info': 'fa-info-circle',
    'warning': 'fa-exclamation-triangle',
    'error': 'fa-times-circle',
    'danger': 'fa-times-circle',
    'default': 'fa-bell'
  };
  return iconMap[type] || iconMap.default;
}

module.exports = router;
