import React from 'react';
import { MapPin, Phone, Mail } from 'lucide-react';

export default function Contact() {
  return (
    <section className="page-marketing">
      <div className="glass-box contact-container">
        {/* Header */}
        <h1 className="contact-title">Contact Us</h1>
        <p className="contact-subtitle">
          Have questions or need support? Reach out to us via phone, email, or send us a message below.
        </p>

        <div className="contact-content">
          {/* Left Column: Contact Info */}
          <div className="contact-info">
            <div className="info-item">
              <Phone size={24} />
              <span>+1 (555) 123-4567</span>
            </div>
            <div className="info-item">
              <Mail size={24} />
              <span>support@freightconnect.com</span>
            </div>
            <div className="info-item">
              <MapPin size={24} />
              <span>123 Logistics Ave, Suite 100, Chicago, IL</span>
            </div>
          </div>

          {/* Right Column: Form */}
          <form className="contact-form">
            <input type="text" name="name" placeholder="Your Name" className="contact-input" required />
            <input type="email" name="email" placeholder="Your Email" className="contact-input" required />
            <textarea name="message" rows={5} placeholder="Your Message" className="contact-input" required />
            <button type="submit" className="btn-pink contact-btn">Send Message</button>
          </form>
        </div>

        {/* Embedded Map (optional) */}
        <div className="map-container">
          <iframe
            title="Office Location"
            src="https://www.google.com/maps/embed?..."
            allowFullScreen
            loading="lazy"
          ></iframe>
        </div>
      </div>
    </section>
  );
}