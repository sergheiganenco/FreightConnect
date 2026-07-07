import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
import api from '../../services/api';
import TeamManager from './TeamManager';

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
});

test('lists team members returned by the API', async () => {
  window.localStorage.setItem('role', 'carrier');
  api.get.mockResolvedValue({
    data: { members: [{ _id: '1', name: 'Dan Dispatcher', email: 'dan@acme.com', companyRole: 'dispatcher', active: true }] },
  });

  render(<TeamManager />);

  expect(await screen.findByText('Dan Dispatcher')).toBeInTheDocument();
  expect(screen.getByText('dan@acme.com')).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith('/users/team');
});

test('carrier framing mentions dispatcher and driver logins, and the add dialog opens', async () => {
  window.localStorage.setItem('role', 'carrier');
  api.get.mockResolvedValue({ data: { members: [] } });

  render(<TeamManager />);
  expect(await screen.findByText(/Dispatcher and driver logins/i)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /add member/i }));
  expect(await screen.findByText('Add team member')).toBeInTheDocument();
});

test('shipper framing is coordinator-only (no driver)', async () => {
  window.localStorage.setItem('role', 'shipper');
  api.get.mockResolvedValue({ data: { members: [] } });

  render(<TeamManager />);

  expect(await screen.findByText(/Coordinator logins under your company/i)).toBeInTheDocument();
  expect(screen.queryByText(/Dispatcher and driver logins/i)).not.toBeInTheDocument();
});
