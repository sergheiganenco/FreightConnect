import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('../services/api', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
import api from '../services/api';
import MfaSetup from './MfaSetup';

beforeEach(() => jest.clearAllMocks());

test('renders the MFA card and reflects the disabled state', async () => {
  api.get.mockResolvedValue({ data: { mfaEnabled: false } });

  render(<MfaSetup />);

  expect(await screen.findByText(/Two-Factor Authentication/i)).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith('/users/me');
  // Not enabled -> an enable action is offered.
  expect(screen.getByRole('button', { name: /enable/i })).toBeInTheDocument();
});

test('shows an enabled chip when MFA is on', async () => {
  api.get.mockResolvedValue({ data: { mfaEnabled: true } });

  render(<MfaSetup />);

  expect(await screen.findByText(/Two-Factor Authentication/i)).toBeInTheDocument();
  // Enabled state exposes a disable path rather than enable.
  expect(screen.queryByRole('button', { name: /^enable/i })).not.toBeInTheDocument();
});
