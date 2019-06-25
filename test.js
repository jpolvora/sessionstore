const sessionStore = require('./lib/session-store')
const mongoose = require('mongoose');
process.env.MONGODB_URI = "";
(async () => {

  const store = new sessionStore({

  })

})()