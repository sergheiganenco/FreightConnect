import React, { useState, useEffect } from "react";
import { List, ListItemButton, ListItemIcon, ListItemText, Tooltip, Badge, Collapse } from "@mui/material";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import DescriptionIcon   from "@mui/icons-material/Description";
import ListAltIcon       from "@mui/icons-material/ListAlt";
import DirectionsCarIcon from "@mui/icons-material/DirectionsCar";
import BadgeIcon from '@mui/icons-material/Badge';
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
import PsychologyIcon from '@mui/icons-material/Psychology';
import AssessmentIcon from '@mui/icons-material/Assessment';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import ReceiptIcon from '@mui/icons-material/Receipt';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
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

// CORE — trucker's daily essentials, always visible
const coreItems = [
  { key: "loads",     label: "Loads",      icon: <LocalShippingIcon /> },
  { key: "myLoads",   label: "My Loads",   icon: <ListAltIcon /> },
  { key: "chat",      label: "Messages",   icon: <ChatNavItem /> },
  { key: "payments",  label: "Payments",   icon: <AccountBalanceWalletIcon /> },
  { key: "documents", label: "Documents",  icon: <DescriptionIcon /> },
  { key: "profile",   label: "Profile",    icon: <AccountCircleIcon /> },
];

// MORE — secondary tools, collapsed by default
const moreItems = [
  { key: "fleet",        label: "Fleet",         icon: <DirectionsCarIcon /> },
  { key: "drivers",      label: "Drivers",       icon: <BadgeIcon /> },
  { key: "fleetMap",     label: "Fleet Map",     icon: <MapIcon /> },
  { key: "trips",        label: "Trip Planning", icon: <RouteIcon /> },
  { key: "eld",          label: "ELD / HOS",     icon: <TimerIcon /> },
  { key: "appointments", label: "Appointments",  icon: <CalendarMonthIcon /> },
  { key: "contracts",    label: "Contracts",     icon: <AssignmentIcon /> },
  { key: "network",      label: "Network",       icon: <PeopleIcon /> },
  { key: "factoring",    label: "Factoring",     icon: <MonetizationOnIcon /> },
  { key: "expenses",     label: "Expenses",      icon: <ReceiptIcon /> },
  { key: "tax",          label: "Tax & 1099",    icon: <ReceiptLongIcon /> },
  { key: "analytics",    label: "Analytics",     icon: <BarChartIcon /> },
  { key: "ai-insights",  label: "AI Insights",   icon: <PsychologyIcon /> },
  { key: "scorecard",    label: "Scorecard",     icon: <AssessmentIcon /> },
];

const moreKeys = moreItems.map((it) => it.key);

export default function SideNav({ current, onSelect, collapsed }) {
  // Auto-expand the More group when the active section lives inside it
  const [moreOpen, setMoreOpen] = useState(() => moreKeys.includes(current));

  useEffect(() => {
    if (moreKeys.includes(current)) setMoreOpen(true);
  }, [current]);

  const renderItem = (it) => {
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
  };

  // In mini/icon mode there's no room for a text toggle — show all items
  // flat as icons so nothing becomes unreachable.
  if (collapsed) {
    return (
      <List sx={{ pt: 2 }}>
        {coreItems.map(renderItem)}
        {moreItems.map(renderItem)}
      </List>
    );
  }

  return (
    <List sx={{ pt: 2 }}>
      {coreItems.map(renderItem)}

      <ListItemButton
        onClick={() => setMoreOpen((v) => !v)}
        sx={{ borderRadius: 2, mb: 1, px: 2 }}
        aria-expanded={moreOpen}
      >
        <ListItemIcon sx={{ color: 'inherit', minWidth: 56 }}>
          {moreOpen ? <ExpandLess /> : <ExpandMore />}
        </ListItemIcon>
        <ListItemText
          primary={moreOpen ? "Less" : "More"}
          primaryTypographyProps={{ fontWeight: 600 }}
        />
      </ListItemButton>

      <Collapse in={moreOpen} timeout="auto" unmountOnExit>
        {moreItems.map(renderItem)}
      </Collapse>
    </List>
  );
}
