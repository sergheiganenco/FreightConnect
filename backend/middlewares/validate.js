const { validationResult } = require('express-validator');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // `error` is the first problem in words, so every form can show it; `errors` keeps the full list.
    const first = errors.array()[0];
    const error = first.msg && first.msg !== 'Invalid value' ? first.msg : `Check the "${first.path}" field.`;
    return res.status(400).json({ error, errors: errors.array() });
  }
  next();
};

module.exports = validate;
