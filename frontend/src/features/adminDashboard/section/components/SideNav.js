// src/features/adminDashboard/sections/components/SideNav.js
import React from "react";
import { List, ListItemButton, ListItemIcon, ListItemText } from "@mui/material";
import DashboardIcon from "@mui/icons-material/Dashboard";
import ListAltIcon from "@mui/icons-material/ListAlt";
import PeopleAltIcon from "@mui/icons-material/PeopleAlt";
import AccountBoxIcon from "@mui/icons-material/AccountBox";
import BusinessIcon from "@mui/icons-material/Business";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";

const NAV = [
  { key: "overview",   icon: <DashboardIcon />,    label: "Overview" },
  { key: "loads",      icon: <ListAltIcon />,       label: "All Loads" },
  { key: "users",      icon: <PeopleAltIcon />,     label: "Users" },
  { key: "companies",  icon: <BusinessIcon />,      label: "Companies" },
  { key: "exceptions", icon: <WarningAmberIcon />,  label: "Exceptions" },
  { key: "profile",    icon: <AccountBoxIcon />,    label: "Profile" },
];

export default function SideNav({ current, collapsed, onSelect }) {
  return (
    <List sx={{ pt: 0 }}>
      {NAV.map(item => (
        <ListItemButton
          key={item.key}
          selected={current === item.key}
          sx={{
            my: 0.7,
            borderRadius: 3,
            minHeight: 44,
            px: collapsed ? 1 : 2,
            bgcolor: current === item.key ? "rgba(240,76,167,0.12)" : "transparent",
          }}
          onClick={() => onSelect(item.key)}
        >
          <ListItemIcon sx={{ color: "#fff", minWidth: 40 }}>{item.icon}</ListItemIcon>
          {!collapsed && (
            <ListItemText
              primary={item.label}
              primaryTypographyProps={{ fontWeight: 700, fontSize: "1.05em" }}
            />
          )}
        </ListItemButton>
      ))}
    </List>
  );
}
