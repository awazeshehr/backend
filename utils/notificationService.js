const Notification = require('../models/Notification');

/**
 * Creates a notification and emits it via Socket.IO
 * @param {Object} params
 * @param {string} params.recipientId - ObjectId of the recipient
 * @param {string} params.recipientModel - 'User', 'FieldOfficer', 'DepartmentAdmin'
 * @param {string} params.title - Notification title
 * @param {string} params.message - Notification body
 * @param {string} params.type - 'info', 'success', 'warning', 'error'
 * @param {string} params.relatedId - ID of related entity (e.g. complaint ID)
 * @param {string} params.relatedTo - 'complaint', 'system', etc.
 */
const sendNotification = async ({
  recipientId,
  recipientModel,
  title,
  message,
  type = 'info',
  relatedId = null,
  relatedTo = 'complaint'
}) => {
  try {
    const notification = new Notification({
      recipient: recipientId,
      recipientModel,
      title,
      message,
      type,
      relatedId,
      relatedTo
    });

    await notification.save();

    // Emit via Socket.IO if available
    if (global.io) {
      // We assume room names are the user IDs
      global.io.to(recipientId.toString()).emit('notificationUpdate', {
        notification
      });
      // Also emit a general event that specific dashboards might listen to
      global.io.to(recipientId.toString()).emit('newNotification', notification);
    }

    return notification;
  } catch (error) {
    console.error('Error sending notification:', error);
    // Don't throw, just log. Notification failure shouldn't break the main flow.
    return null;
  }
};

module.exports = {
  sendNotification
};
