import React from 'react';
import { Box, Container, Paper, Typography, Button, Grid, TextField } from '@mui/material';
import { MapPin, Phone, Mail } from 'lucide-react';
import { gradient, text, glassCard, buttonVariants, darkFieldSx } from '../theme/tokens';

export default function Contact() {
  return (
    <Box sx={{ minHeight: '100vh', background: gradient.dashboardBg, backgroundAttachment: 'fixed', color: text.primary, pt: 12, pb: 8 }}>
      <Container maxWidth="lg" sx={{ px: { xs: 2, md: 4 } }}>
        <Paper sx={{ ...glassCard.elevated, p: { xs: 3, md: 5 } }}>
          {/* Header */}
          <Typography variant="h3" fontWeight={700} gutterBottom>Contact Us</Typography>
          <Typography variant="body1" sx={{ color: text.secondary, mb: 4 }}>
            Have questions or need support? Reach out to us via phone, email, or send us a message below.
          </Typography>

          <Grid container spacing={4}>
            {/* Left Column: Contact Info */}
            <Grid item xs={12} md={5}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Phone size={24} />
                  <Typography>+1 (555) 123-4567</Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Mail size={24} />
                  <Typography>support@freightconnect.com</Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <MapPin size={24} />
                  <Typography>123 Logistics Ave, Suite 100, Chicago, IL</Typography>
                </Box>
              </Box>
            </Grid>

            {/* Right Column: Form */}
            <Grid item xs={12} md={7}>
              <Box component="form" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField
                  name="name"
                  label="Your Name"
                  required
                  fullWidth
                  sx={{ ...darkFieldSx }}
                />
                <TextField
                  name="email"
                  label="Your Email"
                  type="email"
                  required
                  fullWidth
                  sx={{ ...darkFieldSx }}
                />
                <TextField
                  name="message"
                  label="Your Message"
                  multiline
                  rows={5}
                  required
                  fullWidth
                  sx={{ ...darkFieldSx }}
                />
                <Button type="submit" variant="contained" sx={{ ...buttonVariants.gradient, px: 4, py: 1.5, alignSelf: 'flex-start' }}>
                  Send Message
                </Button>
              </Box>
            </Grid>
          </Grid>

          {/* Embedded Map (optional) */}
          <Box sx={{ mt: 4, borderRadius: 2, overflow: 'hidden' }}>
            <iframe
              title="Office Location"
              src="https://www.google.com/maps/embed?..."
              allowFullScreen
              loading="lazy"
              style={{ width: '100%', height: 300, border: 0 }}
            />
          </Box>
        </Paper>
      </Container>
    </Box>
  );
}
