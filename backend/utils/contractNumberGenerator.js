/**
 * Generates sequential contract numbers: FC-YYYY-NNNNN
 * e.g. FC-2026-00001, FC-2026-00002, …
 */

const Contract = require('../models/Contract');

async function generateContractNumber() {
  const year   = new Date().getFullYear();
  const prefix = `FC-${year}-`;

  const lastContract = await Contract.findOne({
    contractNumber: { $regex: `^${prefix}` },
  }).sort({ contractNumber: -1 }).select('contractNumber').lean();

  let nextNum = 1;
  if (lastContract) {
    const parts = lastContract.contractNumber.split('-');
    const lastNum = parseInt(parts[2], 10);
    if (!isNaN(lastNum)) nextNum = lastNum + 1;
  }

  return `${prefix}${String(nextNum).padStart(5, '0')}`;
}

module.exports = { generateContractNumber };
