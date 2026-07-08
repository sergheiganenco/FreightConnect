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

  // The page renders the driver in BOTH a desktop table and a mobile card layout
  // (one hidden via CSS media query, which jsdom doesn't evaluate), so the data
  // appears more than once in the DOM — assert it's present at least once.
  expect((await screen.findAllByText('Rosa Driver')).length).toBeGreaterThan(0);
  expect(screen.getAllByText('Driving').length).toBeGreaterThan(0);     // status chip
  expect(screen.getAllByText('5h 0m left').length).toBeGreaterThan(0);  // 300 min drive remaining
  expect(api.get).toHaveBeenCalledWith('/eld/fleet');
});

test('shows the drivers-only message as an info alert (403)', async () => {
  api.get.mockRejectedValue({ response: { data: { error: 'Fleet HOS is available to owners and dispatchers' } } });

  render(<CarrierFleetHOS />);

  expect(await screen.findByText(/available to owners and dispatchers/i)).toBeInTheDocument();
});
