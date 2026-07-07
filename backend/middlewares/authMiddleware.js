const jwt = require('jsonwebtoken');

const auth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header missing or invalid' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      userId: decoded.userId,
      role: decoded.role,
      companyRole: decoded.companyRole || 'owner',
      // The company an account acts for (owner id). Sub-account tokens carry it;
      // older tokens (owners only) fall back to their own id — same thing.
      companyOwnerId: decoded.companyOwnerId || decoded.userId,
    };
    next();
  } catch (err) {
    console.error('JWT Error:', err);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

module.exports = auth;
