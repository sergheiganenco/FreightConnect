// The server's "Stripe not configured" text is for operators; users get a plain early-access message.
export const payMessage = (msg, fallback) => {
  if (!msg) return fallback;
  return /not configured|STRIPE_SECRET_KEY/i.test(msg) ? 'Payouts are not available yet during early access.' : msg;
};
