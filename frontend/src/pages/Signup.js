import React from 'react';

function Signup() {
  return (
    <div>
      <h2>Signup</h2>
      <form>
        <input type="text" placeholder="Name" /><br/>
        <input type="email" placeholder="Email" /><br/>
        <input type="password" placeholder="Password" /><br/>
        <button type="submit">Sign Up</button>
      </form>
    </div>
  );
}

export default Signup;
