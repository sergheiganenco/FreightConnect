// src/features/shipperDashboard/sections/components/SideNav.js
import React from "react";
import { Tooltip } from "@mui/material";
import LocalShippingIcon from '@mui/icons-material/LocalShipping';   // Loads
import AddBoxIcon from '@mui/icons-material/AddBox';                // Post Load
import DescriptionIcon from '@mui/icons-material/Description';      // Documents
import AccountCircleIcon from '@mui/icons-material/AccountCircle';  // Profile

const navItems = [
  {
    key: "loads",
    label: "Loads",
    icon: <LocalShippingIcon fontSize="medium" />,
  },
  {
    key: "post-load",
    label: "Post Load",
    icon: <AddBoxIcon fontSize="medium" />,
  },
  {
    key: "documents",
    label: "Documents",
    icon: <DescriptionIcon fontSize="medium" />,
  },
  {
    key: "profile",
    label: "Profile",
    icon: <AccountCircleIcon fontSize="medium" />,
  },
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
                    color: isActive ? "#6a1fcf" : "#e6e6fa",
                    background: isActive
                      ? "rgba(255,255,255,0.11)"
                      : "rgba(255,255,255,0.04)",
                    borderLeft: isActive
                      ? "4px solid #6a1fcf"
                      : "4px solid transparent",
                    fontWeight: isActive ? 700 : 500,
                    boxShadow: isActive
                      ? "0 1px 12px #6a1fcf22"
                      : undefined,
                    outline: "none",
                    transition: "background 0.17s, color 0.18s, border-left 0.18s, box-shadow 0.15s",
                  }}
                  onFocus={e => (e.target.style.boxShadow = "0 0 0 2px #e1129a44")}
                  onBlur={e => (e.target.style.boxShadow = isActive ? "0 1px 12px #6a1fcf22" : "none")}
                  onMouseOver={e => (e.currentTarget.style.background = "rgba(255,255,255,0.09)")}
                  onMouseOut={e => (e.currentTarget.style.background = isActive ? "rgba(255,255,255,0.11)" : "rgba(255,255,255,0.04)")}
                >
                  <span
                    style={{
                      minWidth: 32,
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                      color: isActive ? "#6a1fcf" : "#bdbfff",
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
                        color: isActive ? "#fff" : "#d1d5db",
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
