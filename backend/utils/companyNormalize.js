// utils/companyNormalize.js

function companyNormalize(name) {
 if (!name || typeof name !== "string") return null;
  return name
    .toLowerCase()
    .replace(/[,.\-]/g, '')
    .replace(/\b(llc|inc|ltd|corp|co|plc)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = companyNormalize;
