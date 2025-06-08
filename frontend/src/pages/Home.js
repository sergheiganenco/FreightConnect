// src/pages/Home.js
import React from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, FileText, Eye, Ban } from 'lucide-react';
import { motion } from 'framer-motion';
import Testimonials from '../components/Testimonials';  // ← relative path

export default function Home() {
  const benefits = [
    {
      icon: <Sparkles />,
      title: 'AI-Powered Load Matching',
      desc:
        'Match loads with carriers automatically to maximize utilization.',
      accent: 'accent-0',
    },
    {
      icon: <FileText />,
      title: 'Automated Documents',
      desc:
        'Generate & store BOL, rate cons, PODs without manual entry.',
      accent: 'accent-1',
    },
    {
      icon: <Eye />,
      title: 'Real-Time Visibility',
      desc:
        'Live GPS tracking and predictive ETAs for every shipment.',
      accent: 'accent-2',
    },
    {
      icon: <Ban />,
      title: 'Zero Broker Fees',
      desc: 'Connect directly—keep the margin you earn.',
      accent: 'accent-3',
    },
  ];

  return (
    <section className="page-marketing">
      <div className="glass-box">
        {/* Hero */}
        <motion.div
          className="hero"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          <h1>Transform Your Freight Operations with AI</h1>
          <p>
            Optimize logistics with intelligent load matching, automated
            document processing, and real-time visibility.
          </p>
          <Link to="/signup" className="btn-pink">
            Get Started
          </Link>
        </motion.div>

        {/* Feature cards */}
        <div className="benefit-grid">
          {benefits.map((b, idx) => (
            <motion.div
              key={b.title}
              className={`card--marketing ${b.accent}`}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: idx * 0.1 }}
            >
              <div className="icon-box">{b.icon}</div>
              <h3>{b.title}</h3>
              <p>{b.desc}</p>
            </motion.div>
          ))}
        </div>

        {/* Testimonials */}
        <Testimonials />
      </div>
    </section>
  );
}
