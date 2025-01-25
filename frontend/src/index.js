import React from 'react';
import ReactDOM from 'react-dom/client'; // Use the new createRoot API
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root')); // Create a root for rendering
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
