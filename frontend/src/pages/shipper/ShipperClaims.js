/**
 * ShipperClaims — thin wrapper around the shared ClaimsBoard for shippers.
 * Route + nav are wired by the maintainer.
 */

import React from 'react';
import ClaimsBoard from '../../features/shared/ClaimsBoard';

export default function ShipperClaims() {
  return <ClaimsBoard role="shipper" />;
}
