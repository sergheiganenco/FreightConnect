const mongoose = require('mongoose');

/**
 * Counter — atomic monotonic sequence generator.
 *
 * Used for gap-free, race-free sequential numbering (e.g. invoice numbers).
 * `findByIdAndUpdate({ $inc: { seq: 1 } }, { upsert: true, new: true })` is a
 * single atomic Mongo op, so concurrent callers never collide (unlike
 * countDocuments()+1, which races and trips the unique index).
 */
const CounterSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // e.g. "invoice-2026"
  seq: { type: Number, default: 0 },
});

CounterSchema.statics.next = async function (key) {
  const doc = await this.findByIdAndUpdate(
    key,
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return doc.seq;
};

module.exports = mongoose.model('Counter', CounterSchema);
