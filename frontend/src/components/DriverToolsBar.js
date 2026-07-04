import React from 'react';
import { Stack, Button, Typography, Box } from '@mui/material';
import NavigationRoundedIcon from '@mui/icons-material/NavigationRounded';
import LocalParkingRoundedIcon from '@mui/icons-material/LocalParkingRounded';
import LocalGasStationRoundedIcon from '@mui/icons-material/LocalGasStationRounded';
import CloudRoundedIcon from '@mui/icons-material/CloudRounded';

/**
 * DriverToolsBar — one-tap deep links to best-in-class road tools.
 *
 * Best practice: we do NOT rebuild commodity data (parking availability, fuel
 * prices, turn-by-turn) that dedicated apps already do better and keep fresh.
 * We link out, so drivers get the right tool and we own zero data/liability.
 * On phones these URLs open the native app if installed, otherwise the web app.
 *
 * @param {string|{lat:number,lng:number}} [destination] optional — deep-links
 *        the Navigate button straight to directions for this load's drop.
 * @param {boolean} [dark=true] style for dark (map) vs light surfaces.
 * @param {string}  [title='Driver Tools'] small heading; pass '' to hide.
 */
export default function DriverToolsBar({ destination, dark = true, title = 'Driver Tools' }) {
  const navHref = destination
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
        typeof destination === 'string' ? destination : `${destination.lat},${destination.lng}`,
      )}`
    : 'https://www.google.com/maps';

  const tools = [
    { key: 'navigate', label: 'Navigate',      provider: 'Google Maps',  icon: <NavigationRoundedIcon fontSize="small" />,       href: navHref },
    { key: 'parking',  label: 'Truck Parking', provider: 'Trucker Path', icon: <LocalParkingRoundedIcon fontSize="small" />,     href: 'https://truckerpath.com/' },
    { key: 'fuel',     label: 'Fuel Prices',   provider: 'GasBuddy',     icon: <LocalGasStationRoundedIcon fontSize="small" />,  href: 'https://www.gasbuddy.com/' },
    { key: 'weather',  label: 'Weather',       provider: 'NWS',          icon: <CloudRoundedIcon fontSize="small" />,            href: 'https://forecast.weather.gov/' },
  ];

  return (
    <Box>
      {title ? (
        <Typography
          variant="overline"
          sx={{ display: 'block', mb: 0.5, letterSpacing: 1, color: dark ? 'rgba(255,255,255,0.6)' : 'text.secondary' }}
        >
          {title}
        </Typography>
      ) : null}
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
        {tools.map((t) => (
          <Button
            key={t.key}
            component="a"
            href={t.href}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open in ${t.provider}`}
            variant="outlined"
            size="small"
            startIcon={t.icon}
            sx={{
              textTransform: 'none',
              fontWeight: 600,
              borderRadius: 2,
              color: dark ? '#fff' : 'text.primary',
              borderColor: dark ? 'rgba(255,255,255,0.35)' : 'divider',
              '&:hover': {
                borderColor: dark ? '#fff' : 'primary.main',
                bgcolor: dark ? 'rgba(255,255,255,0.08)' : 'action.hover',
              },
            }}
          >
            {t.label}
          </Button>
        ))}
      </Stack>
    </Box>
  );
}
