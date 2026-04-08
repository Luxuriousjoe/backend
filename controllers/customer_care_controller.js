const db = require('../config/db_config');
const logger = require('../utils/logger');

async function hasCustomerCareTable() {
  const [rows] = await db
    .promise()
    .query('SHOW TABLES LIKE ?', ['customer_care_feedback']);
  return rows.length > 0;
}

function sanitizeText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

exports.submitIssue = async (req, res, next) => {
  try {
    if (!(await hasCustomerCareTable())) {
      return res.status(503).json({
        success: false,
        message:
          'customer_care_feedback table is missing. Run the SQL script first.',
      });
    }

    const fullName = sanitizeText(req.body.full_name, req.user?.name || '');
    const whatsappNumber = sanitizeText(req.body.whatsapp_number);
    const issueMessage = sanitizeText(req.body.issue_message);

    if (!fullName) {
      return res
        .status(400)
        .json({ success: false, message: 'Full name is required' });
    }
    if (!whatsappNumber) {
      return res
        .status(400)
        .json({ success: false, message: 'WhatsApp number is required' });
    }
    if (!issueMessage) {
      return res
        .status(400)
        .json({ success: false, message: 'Issue message is required' });
    }

    const [result] = await db.promise().query(
      `INSERT INTO customer_care_feedback (
         user_id,
         full_name,
         whatsapp_number,
         issue_message,
         is_attended
       ) VALUES (?, ?, ?, ?, 0)`,
      [req.user?.id || null, fullName, whatsappNumber, issueMessage]
    );

    return res.status(201).json({
      success: true,
      message: 'Issue submitted successfully',
      data: { id: result.insertId },
    });
  } catch (error) {
    logger.error(`customerCare.submitIssue error: ${error.message}`);
    next(error);
  }
};

exports.getAdminList = async (req, res, next) => {
  try {
    if (!(await hasCustomerCareTable())) {
      return res.status(503).json({
        success: false,
        message:
          'customer_care_feedback table is missing. Run the SQL script first.',
      });
    }

    const [rows] = await db.promise().query(
      `SELECT
         f.id,
         f.user_id,
         f.full_name,
         f.whatsapp_number,
         f.issue_message,
         f.is_attended,
         f.attended_at,
         f.created_at,
         submitter.name AS submitted_by_name,
         attended_by_user.name AS attended_by_name
       FROM customer_care_feedback f
       LEFT JOIN users submitter ON submitter.id = f.user_id
       LEFT JOIN users attended_by_user ON attended_by_user.id = f.attended_by
       ORDER BY f.is_attended ASC, f.created_at DESC`
    );

    return res.json({ success: true, data: rows });
  } catch (error) {
    logger.error(`customerCare.getAdminList error: ${error.message}`);
    next(error);
  }
};

exports.markAttended = async (req, res, next) => {
  try {
    if (!(await hasCustomerCareTable())) {
      return res.status(503).json({
        success: false,
        message:
          'customer_care_feedback table is missing. Run the SQL script first.',
      });
    }

    const { id } = req.params;
    const [rows] = await db.promise().query(
      'SELECT id, is_attended FROM customer_care_feedback WHERE id = ? LIMIT 1',
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Feedback not found' });
    }

    if (Number(rows[0].is_attended) === 1) {
      return res.json({
        success: true,
        message: 'Feedback is already marked as attended',
      });
    }

    await db.promise().query(
      `UPDATE customer_care_feedback
       SET is_attended = 1,
           attended_by = ?,
           attended_at = NOW()
       WHERE id = ?`,
      [req.user?.id || null, id]
    );

    return res.json({ success: true, message: 'Feedback marked as attended' });
  } catch (error) {
    logger.error(`customerCare.markAttended error: ${error.message}`);
    next(error);
  }
};

