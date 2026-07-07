/**
 * CarrierClaims — thin wrapper around the shared ClaimsBoard for carriers.
 * Route + nav are wired by the maintainer.
 */

import React from 'react';
import ClaimsBoard from '../../features/shared/ClaimsBoard';

export default function CarrierClaims() {
  return <ClaimsBoard role="carrier" />;
}
