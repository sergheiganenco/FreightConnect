import React from "react";
import { List, ListItemButton, ListItemIcon, ListItemText, Tooltip } from "@mui/material";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import DescriptionIcon   from "@mui/icons-material/Description";
import ListAltIcon       from "@mui/icons-material/ListAlt";
import DirectionsCarIcon from "@mui/icons-material/DirectionsCar";    // Fleet
import MapIcon from '@mui/icons-material/Map';
import BarChartIcon from '@mui/icons-material/BarChart';


const navItems = [
  { key: "loads",     label: "Loads",      icon: <LocalShippingIcon /> },
  { key: "documents", label: "Documents",  icon: <DescriptionIcon /> },
  { key: "myLoads",   label: "My Loads",   icon: <ListAltIcon /> },
  { key: "fleet",     label: "Fleet",      icon: <DirectionsCarIcon /> },   
  { key: "fleetMap",  label: "Fleet Map", icon: <MapIcon /> },        
  { key: "analytics", label: "Analytics", icon: <BarChartIcon /> }, 
  { key: "profile",   label: "Profile",    icon: <DirectionsCarIcon /> },   
  
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
