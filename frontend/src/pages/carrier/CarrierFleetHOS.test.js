import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('../../services/api', () => ({ __esModule: true, default: { get: jest.fn() } }));
import api from '../../services/api';
import CarrierFleetHOS from './CarrierFleetHOS';

beforeEach(() => jest.clearAllMocks());

test('renders a per-driver HOS row from the fleet endpoint', async () => {
  api.get.mockResolvedValue({
    data: {
      date: '2026-03-10',
      drivers: [{
        driverId: 'd1', name: 'Rosa Driver', companyRole: 'driver',
        currentStatus: 'DRIVING', driveRemainingMinutes: 300,
        windowRemainingMinutes: 400, drivingMinutesToday: 360, violations: 0, certified: false,
      }],
    },
  });

  render(<CarrierFleetHOS />);

  expect(await screen.findByText('Rosa Driver')).toBeInTheDocument();
  expect(screen.getByText('Driving')).toBeInTheDocument();      // status chip
  expect(screen.getByText('5h 0m left')).toBeInTheDocument();   // 300 min drive remaining
  expect(api.get).toHaveBeenCalledWith('/eld/fleet');
});

test('shows the drivers-only message as an info alert (403)', async () => {
  api.get.mockRejectedValue({ response: { data: { error: 'Fleet HOS is available to owners and dispatchers' } } });

  render(<CarrierFleetHOS />);

  expect(await screen.findByText(/available to owners and dispatchers/i)).toBeInTheDocument();
});
