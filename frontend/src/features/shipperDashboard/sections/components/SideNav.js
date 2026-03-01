import React from "react";
import { Tooltip, Badge } from "@mui/material";
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import AddBoxIcon from '@mui/icons-material/AddBox';
import DescriptionIcon from '@mui/icons-material/Description';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import BarChartIcon from '@mui/icons-material/BarChart';
import ChatIcon from '@mui/icons-material/Chat';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import AssignmentIcon from '@mui/icons-material/Assignment';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import CodeIcon from '@mui/icons-material/Code';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import { useChatContext } from '../../../../components/chat/ChatProvider';
import { brand, surface, text as T, tint } from '../../../../theme/tokens';

function ChatNavItem() {
  let unread = 0;
  try {
    const ctx = useChatContext();
    unread = ctx?.totalUnread || 0;
  } catch { /* ChatProvider not mounted yet */ }
  return (
    <Badge badgeContent={unread || null} color="error" max={9}>
      <ChatIcon fontSize="medium" />
    </Badge>
  );
}

const navItems = [
  { key: "loads",     label: "Loads",     icon: <LocalShippingIcon fontSize="medium" /> },
  { key: "post-load", label: "Post Load", icon: <AddBoxIcon fontSize="medium" /> },
  { key: "contracts",    label: "Contracts",    icon: <AssignmentIcon fontSize="medium" /> },
  { key: "appointments", label: "Appointments", icon: <CalendarMonthIcon fontSize="medium" /> },
  { key: "documents",    label: "Documents",    icon: <DescriptionIcon fontSize="medium" /> },
  { key: "analytics", label: "Analytics", icon: <BarChartIcon /> },
  { key: "payments",  label: "Payments",  icon: <AccountBalanceWalletIcon fontSize="medium" /> },
  { key: "tax",       label: "Tax",       icon: <ReceiptLongIcon fontSize="medium" /> },
  { key: "edi",       label: "EDI",       icon: <CodeIcon fontSize="medium" /> },
  { key: "chat",      label: "Messages",  icon: <ChatNavItem /> },
  { key: "profile",   label: "Profile",   icon: <AccountCircleIcon fontSize="medium" /> },
];

export default function SideNav({ current, collapsed, onSelect }) {
  return (
    <nav style={{ width: "100%" }}>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: "10px 0",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {navItems.map((item) => {
          const isActive = current === item.key;
          return (
            <li key={item.key}>
              <Tooltip title={collapsed ? item.label : ""} placement="right" arrow>
                <div
                  tabIndex={0}
                  role="button"
                  aria-label={item.label}
                  onClick={() => onSelect(item.key)}
                  onKeyDown={e => {
                    if (e.key === "Enter" || e.key === " ") onSelect(item.key);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    height: 48,
                    margin: "4px 0",
                    padding: collapsed ? "0 8px" : "0 22px 0 18px",
                    borderRadius: "14px",
                    cursor: "pointer",
                    color: isActive ? brand.primary : brand.lavender,
                    background: isActive ? surface.glassActive : surface.glassLight,
                    borderLeft: isActive
                      ? `4px solid ${brand.primary}`
                      : "4px solid transparent",
                    fontWeight: isActive ? 700 : 500,
                    boxShadow: isActive
                      ? `0 1px 12px ${tint(brand.primary, 0.13)}`
                      : undefined,
                    outline: "none",
                    transition: "background 0.17s, color 0.18s, border-left 0.18s, box-shadow 0.15s",
                  }}
                  onFocus={e => (e.target.style.boxShadow = `0 0 0 2px ${tint(brand.secondary, 0.27)}`)}
                  onBlur={e => (e.target.style.boxShadow = isActive ? `0 1px 12px ${tint(brand.primary, 0.13)}` : "none")}
                  onMouseOver={e => (e.currentTarget.style.background = surface.glassMid)}
                  onMouseOut={e => (e.currentTarget.style.background = isActive ? surface.glassActive : surface.glassLight)}
                >
                  <span
                    style={{
                      minWidth: 32,
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                      color: isActive ? brand.primary : brand.softIndigo,
                      transition: "color 0.18s",
                    }}
                  >
                    {item.icon}
                  </span>
                  {!collapsed && (
                    <span
                      style={{
                        marginLeft: 16,
                        fontSize: "1.06rem",
                        letterSpacing: 0.5,
                        fontWeight: isActive ? 700 : 500,
                        whiteSpace: "nowrap",
                        color: isActive ? T.primary : T.navInactive,
                        transition: "color 0.18s",
                      }}
                    >
                      {item.label}
                    </span>
                  )}
                </div>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
