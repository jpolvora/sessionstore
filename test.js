const express = require('express');
const request = require('request');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const SessionStore = require('./lib/session-store');

const COLLECTION_NAME = "_sess";
(async () => {
  await mongoose.connect("mongodb://localhost/sessionstore-tests", {
    useNewUrlParser: true
  });

  //await mongoose.connection.db.dropCollection(COLLECTION_NAME)
  const app = express();
  app.use(cookieParser("mysecret"));
  const sessionStore = new SessionStore({
    secret: "mysecret",
    store: {
      type: 'mongoose',
      collectionName: COLLECTION_NAME,
      mongoose: mongoose //your working mongoose connection here
    }
  })


  /* not required: simple logger function */
  function log(eventName) {
    return (...args) => {
      console.debug(eventName, ...args);
    }
  }

  sessionStore.on('session_started', log('session_started'))
  sessionStore.on('session_stored', log('session_stored'))
  sessionStore.on('session_destroyed', log('session_destroyed'))

  app.use(sessionStore.middleware);

  app.use((req, res) => {
    return res.json({
      success: true,
      message: "hello world!"
    });
  })

  app.listen(3000, () => {
    const fn = request.defaults({ jar: true });
    let count = 3;
    while (count > 0) {
      count--
      fn('http://localhost:3000/', function (err, res, body) {
        if (err) throw err;
        console.log(res.headers['set-cookie'][0])
      });
    }

  });
})()