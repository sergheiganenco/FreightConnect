// src/pages/ShipperDashboardTabs.js
import React, { useState } from 'react';
import { Box, Tabs, Tab, Typography } from '@mui/material';
import ShipperPostLoad from './ShipperPostLoad';
import ShipperLoads from './ShipperLoads';

function ShipperDashboardTabs() {
  const [activeTab, setActiveTab] = useState(0);

  const handleTabChange = (event, newValue) => {
    setActiveTab(newValue);
  };

  return (
    <Box sx={{ maxWidth: 1200, margin: '0 auto', p: 2 }}>
      <Typography variant="h4" gutterBottom>
        Shipper Dashboard
      </Typography>
      <Tabs value={activeTab} onChange={handleTabChange} variant="fullWidth">
        <Tab label="Post Load" id="tab-0" aria-controls="tabpanel-0" />
        <Tab label="Loads" id="tab-1" aria-controls="tabpanel-1" />
      </Tabs>
      <TabPanel value={activeTab} index={0}>
        <ShipperPostLoad />
      </TabPanel>
      <TabPanel value={activeTab} index={1}>
        <ShipperLoads />
      </TabPanel>
    </Box>
  );
}

function TabPanel(props) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`tabpanel-${index}`}
      aria-labelledby={`tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ pt: 2 }}>{children}</Box>}
    </div>
  );
}

export default ShipperDashboardTabs;
