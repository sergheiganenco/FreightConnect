// src/pages/Features.js
import React from 'react';
import { Sparkles, FileText, Eye, Ban } from 'lucide-react';
import { motion } from 'framer-motion';

const features = [
  {
    icon: <Sparkles />,
    title: 'AI Matching',
    desc: 'Maximize fleet utilization automatically.',
    accent: 'accent-0',
  },
  {
    icon: <FileText />,
    title: 'Auto Documents',
    desc: 'Instant BOL, rate con, POD generation.',
    accent: 'accent-1',
  },
  {
    icon: <Eye />,
    title: 'Live Tracking',
    desc: 'GPS + predictive ETAs on every shipment.',
    accent: 'accent-2',
  },
  {
    icon: <Ban />,
    title: 'No Broker Fees',
    desc: 'Keep your full margin—book directly.',
    accent: 'accent-3',
  },
];

export default function Features() {
  return (
    <section className="page-marketing">
      <div className="glass-box features-wrapper">
        <h1 className="features-title">Platform Features</h1>
        <div className="benefit-grid">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              className={`card--marketing feature-card ${f.accent}`}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: i * 0.1 }}
            >
              <div className="icon-box">{f.icon}</div>
              <h3 className="feature-title">{f.title}</h3>
              <p className="feature-desc">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
