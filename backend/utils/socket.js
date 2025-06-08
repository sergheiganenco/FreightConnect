// /utils/socket.js
let io;
module.exports = {
  setIO: instance => { io = instance; },
  getIO: () => io,
};
