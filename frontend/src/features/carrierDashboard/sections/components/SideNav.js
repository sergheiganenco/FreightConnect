import React from "react";
import { List, ListItemButton, ListItemIcon, ListItemText, Tooltip, Badge } from "@mui/material";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import DescriptionIcon   from "@mui/icons-material/Description";
import ListAltIcon       from "@mui/icons-material/ListAlt";
import DirectionsCarIcon from "@mui/icons-material/DirectionsCar";
import MapIcon from '@mui/icons-material/Map';
import BarChartIcon from '@mui/icons-material/BarChart';
import ChatIcon from '@mui/icons-material/Chat';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import PeopleIcon from '@mui/icons-material/People';
import AssignmentIcon from '@mui/icons-material/Assignment';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import RouteIcon from '@mui/icons-material/Route';
import TimerIcon from '@mui/icons-material/Timer';
import MonetizationOnIcon from '@mui/icons-material/MonetizationOn';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import { useChatContext } from '../../../../components/chat/ChatProvider';

function ChatNavItem() {
  let unread = 0;
  try {
    const ctx = useChatContext();
    unread = ctx?.totalUnread || 0;
  } catch { /* ChatProvider not mounted yet */ }
  return (
    <Badge badgeContent={unread || null} color="error" max={9}>
      <ChatIcon />
    </Badge>
  );
}

const navItems = [
  { key: "loads",     label: "Loads",      icon: <LocalShippingIcon /> },
  { key: "documents", label: "Documents",  icon: <DescriptionIcon /> },
  { key: "myLoads",   label: "My Loads",   icon: <ListAltIcon /> },
  { key: "contracts",    label: "Contracts",    icon: <AssignmentIcon /> },
  { key: "appointments", label: "Appointments", icon: <CalendarMonthIcon /> },
  { key: "trips",        label: "Trip Planning", icon: <RouteIcon /> },
  { key: "eld",          label: "ELD / HOS",     icon: <TimerIcon /> },
  { key: "fleet",        label: "Fleet",         icon: <DirectionsCarIcon /> },
  { key: "fleetMap",  label: "Fleet Map",  icon: <MapIcon /> },
  { key: "analytics", label: "Analytics",  icon: <BarChartIcon /> },
  { key: "payments",   label: "Payments",   icon: <AccountBalanceWalletIcon /> },
  { key: "factoring", label: "Factoring",  icon: <MonetizationOnIcon /> },
  { key: "tax",       label: "Tax & 1099", icon: <ReceiptLongIcon /> },
  { key: "network",   label: "Network",    icon: <PeopleIcon /> },
  { key: "chat",      label: "Messages",   icon: <ChatNavItem /> },
  { key: "profile",   label: "Profile",    icon: <AccountCircleIcon /> },
];

export default function SideNav({ current, onSelect, collapsed }) {
  return (
    <List sx={{ pt: 2 }}>
      {navItems.map((it) => {
        const Btn = (
          <ListItemButton
            key={it.key}
            selected={current === it.key}
            onClick={() => onSelect(it.key)}
            sx={{ borderRadius: 2, mb: 1, px: collapsed ? 1 : 2 }}
          >
            <ListItemIcon sx={{ color: 'inherit', minWidth: collapsed ? 40 : 56 }}>
              {it.icon}
            </ListItemIcon>
            {!collapsed && (
              <ListItemText
                primary={it.label}
                primaryTypographyProps={{ fontWeight: 600 }}
              />
            )}
          </ListItemButton>
        );
        return collapsed ? (
          <Tooltip key={it.key} title={it.label} placement="right">
            {Btn}
          </Tooltip>
        ) : (
          Btn
        );
      })}
    </List>
  );
}
