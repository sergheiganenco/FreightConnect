import React from 'react';
import { Stepper, Step, StepLabel, Box, Typography, Container, Paper } from '@mui/material';
import CountUp from 'react-countup';
import Slider from 'react-slick';
import 'slick-carousel/slick/slick.css';
import 'slick-carousel/slick/slick-theme.css';
import { UserCircle } from 'lucide-react';
import { gradient, text, glassCard, surface } from '../theme/tokens';

// Team data: founder first
const team = [
  { name: 'John Smith', role: 'Founder & CEO', img: '/images/john.jpg' },
  { name: 'Alice Wong', role: 'CTO',            img: '/images/alice.jpg' },
  { name: 'Bob Patel',  role: 'Head of AI',    img: '/images/bob.jpg' },
  // ... other members
];

export default function About() {
  const steps = ['Post a Load', 'AI Matches Carrier', 'Track in Real-Time'];

  const sliderSettings = {
    dots: true,
    infinite: true,
    speed: 500,
    slidesToShow: 3,
    slidesToScroll: 1,
    responsive: [{ breakpoint: 768, settings: { slidesToShow: 1 } }]
  };

  return (
    <Box sx={{ minHeight: '100vh', background: gradient.dashboardBg, backgroundAttachment: 'fixed', color: text.primary, pt: 12, pb: 8 }}>
      <Container maxWidth="lg" sx={{ px: { xs: 2, md: 4 } }}>
        <Paper sx={{ ...glassCard.elevated, p: { xs: 3, md: 5 } }}>
          {/* Hero Intro */}
          <Typography variant="h3" gutterBottom>About FreightConnect</Typography>
          <Typography variant="body1" gutterBottom>
            Our mission is to revolutionize freight logistics with cutting-edge AI solutions.
          </Typography>

          {/* How It Works Stepper */}
          <Box sx={{ width:'100%', mt:6, mb:6, bgcolor:'transparent' }}>
            <Stepper alternativeLabel activeStep={1}>
              {steps.map(label => (
                <Step key={label}>
                  <StepLabel sx={{ '& .MuiStepLabel-label':{ color:'#fff' } }}>
                    {label}
                  </StepLabel>
                </Step>
              ))}
            </Stepper>
          </Box>

          {/* Stats Counters */}
          <Box sx={{ display:'flex', gap:8, justifyContent:'center', mb:6, flexWrap:'wrap' }}>
            <Box textAlign="center">
              <Typography variant="h4"><CountUp end={1200} duration={2}/>+</Typography>
              <Typography>Loads Matched</Typography>
            </Box>
            <Box textAlign="center">
              <Typography variant="h4"><CountUp end={98} duration={2}/>%</Typography>
              <Typography>Utilization</Typography>
            </Box>
            <Box textAlign="center">
              <Typography variant="h4"><CountUp end={500} duration={2}/>+</Typography>
              <Typography>Customers</Typography>
            </Box>
          </Box>

          {/* Team Carousel (Founder included) */}
          <Typography variant="h5" gutterBottom textAlign="center">Meet Our Team</Typography>

          <Slider {...sliderSettings}>
            {team.map(m => (
              <Box key={m.name} sx={{ textAlign: 'center', px: 2 }}>
                <Box
                  component="img"
                  src={m.img}
                  alt={m.name}
                  sx={{ width: 120, height: 120, borderRadius: '50%', objectFit: 'cover', mx: 'auto' }}
                />
                <Typography variant="h6" sx={{ mt:2 }}>{m.name}</Typography>
                <Typography variant="body2" color="text.secondary">{m.role}</Typography>
              </Box>
            ))}
          </Slider>
        </Paper>
      </Container>
    </Box>
  );
}
