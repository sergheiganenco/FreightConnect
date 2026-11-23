/**
 * contactRoutes.js — POST /api/contact: the public "Contact us" form.
 *
 * No login. The message is delivered to every admin as an in-app notification (no mailbox or phone number is published).
 * ponytail: admin notifications are the inbox (kept 90 days); add a ContactMessage model + admin page if volume needs triage.
 */
const express = require('express');
const { body } = require('express-validator');
const validate = require('../middlewares/validate');
const { makeLimiter } = require('../middlewares/rateLimiter');
const { notifyAdmins } = require('../utils/notifyUser');

const router = express.Router();

const contactLimiter = makeLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5, // per IP per hour
  message: { error: 'Too many messages. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
}, 'rl:contact:');

// Everyone together: many addresses cannot flood the admins' inboxes either.
const contactGlobalLimiter = makeLimiter({
  windowMs: 24 * 60 * 60 * 1000,
  max: 200,
  keyGenerator: () => 'all',
  message: { error: 'Too many messages. Please try again later.' },
  standardHeaders: false,
  legacyHeaders: false,
}, 'rl:contact-all:');

// Plain text only: no control characters, no markup.
const clean = (v) => String(v).replace(/[\u0000-\u0008\u000b-\u001f\u007f<>]/g, ' ').trim();

router.post('/', contactLimiter, contactGlobalLimiter,
  body('name').isString().withMessage('Name is required').trim().isLength({ min: 1, max: 100 }).withMessage('Name must be 1 to 100 characters'),
  body('email').isString().withMessage('Email is required').trim().isLength({ max: 200 }).isEmail().withMessage('Enter a valid email address'),
  body('message').isString().withMessage('Message is required').trim().isLength({ min: 10, max: 2000 }).withMessage('Message must be 10 to 2000 characters'),
  body('website').optional({ nullable: true }).isString().isLength({ max: 200 }),
  validate,
  async (req, res) => {
    try {
      // Honeypot: a field people never see. A bot that fills it gets the same answer and nothing is delivered.
      if (req.body.website) return res.json({ success: true });
      const name = clean(req.body.name);
      const email = clean(req.body.email);
      const message = clean(req.body.message);
      await notifyAdmins({
        type: 'contact:message',
        title: `Contact form: ${name}`.slice(0, 120),
        body: `From ${name} <${email}>\n\n${message}`.replace(/[<>]/g, ' '),
        link: null,
        metadata: { name, email },
      });
      res.json({ success: true });
    } catch (err) {
      console.error('[contact] failed:', err.message);
      res.status(500).json({ error: 'Could not send your message. Please try again.' });
    }
  });

module.exports = router;
