// src/components/Testimonials.js
import React from 'react';
import { motion } from 'framer-motion';

const testimonials = [
  {
    quote: '"FreightConnect cut my empty miles in half and boosted revenue."',
    author: 'Jane Doe, Owner at Doe Transport',
  },
  {
    quote: '"Our logistics costs dropped by 20% thanks to AI-driven matching."',
    author: 'Global Foods Inc.',
  },
];

export default function Testimonials() {
  return (
    <motion.section
      className="testimonials"
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.8 }}
    >
      <h2>What Our Users Say</h2>
      <div className="testimonial-grid">
        {testimonials.map((t, i) => (
          <motion.div
            key={i}
            className="testimonial-card"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: i * 0.2 }}
          >
            <p>{t.quote}</p>
            <footer>- {t.author}</footer>
          </motion.div>
        ))}
      </div>
    </motion.section>
  );
}
