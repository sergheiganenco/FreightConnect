const jwt = require('jsonwebtoken');

const auth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  console.log('Backend Auth Header:', authHeader); // explicit logging

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header missing or invalid' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      userId: decoded.userId,
      role: decoded.role,
    };
    next();
  } catch (err) {
    console.error('JWT Error:', err);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

module.exports = auth;
