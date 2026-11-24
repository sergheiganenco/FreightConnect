import React, { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import api from '../../services/api';

const usd = (cents) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The same three numbers for shipper and carrier: what the shipper pays, the platform fee, what the carrier receives. */
export default function PriceBreakdown({ rateCents }) {
  const [b, setB] = useState(null);

  useEffect(() => {
    if (!Number.isInteger(rateCents) || rateCents <= 0) { setB(null); return undefined; }
    let live = true;
    api.get('/payments/price-breakdown', { params: { amountCents: rateCents } })
      .then(({ data }) => { if (live) setB(data); })
      .catch(() => { if (live) setB(null); });
    return () => { live = false; };
  }, [rateCents]);

  if (!b) return null;
  const row = (label, value, strong) => (
    <Box display="flex" justifyContent="space-between" gap={2}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="body2" fontWeight={strong ? 800 : 600} sx={{ whiteSpace: 'nowrap' }}>{value}</Typography>
    </Box>
  );
  return (
    <Box sx={{ mb: 2, p: 1.5, borderRadius: 2, border: '1px solid rgba(255,255,255,0.12)' }}>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.65rem', letterSpacing: 1 }}>
        Price, as both sides see it
      </Typography>
      {row('Shipper pays', usd(b.shipperPaysCents))}
      {row(`FreightConnect fee (${b.feePercent}%)`, `- ${usd(b.platformFeeCents)}`)}
      {row('Carrier receives', usd(b.carrierReceivesCents), true)}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
        {b.paymentsOn
          ? 'The fee is the only amount FreightConnect keeps. There is no other margin.'
          : 'Payments through FreightConnect are not switched on yet, so no fee is taken today and the shipper pays the carrier directly. These are the amounts that will apply.'}
      </Typography>
    </Box>
  );
}
