const express = require('express');
const request = require('request');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const SessionStore = require('./lib/session-store');
const debug = require('debug');
console.log('debug:', process.env.DEBUG);
const logger = debug('tests')
debug.enable('tests');
debug.enable('sessionstore');

const COLLECTION_NAME = "_sess";
(async () => {
  await mongoose.connect("mongodb://localhost/sessionstore-tests", {
    useNewUrlParser: true,
    useCreateIndex: true,
    useFindAndModify: false
  });
  try {
    await new Promise((resolve, reject) => {

      mongoose.connection.db.dropCollection(COLLECTION_NAME, (err) => {
        if (err) return reject(err);
        return resolve(true);
      });
    });

  } catch (error) {
    logger("error on droping collection", error);
  }


  const app = express();
  app.use(express.static('/favicon.ico'));
  app.use(cookieParser("mysecret"));
  const sessionStore = new SessionStore({
    store: {
      type: 'mongoose',
      collectionName: COLLECTION_NAME,
      mongoose: mongoose //your working mongoose connection here
    }
  })


  /* not required: simple logger function */
  function log(eventName) {
    return (...args) => {
      return logger('sessionstore events:' + eventName, ...args);
    }
  }

  sessionStore.on('init', log('init'))
  sessionStore.on('session_started', log('session_started'))
  sessionStore.on('session_stored', log('session_stored'))
  sessionStore.on('session_destroyed', log('session_destroyed'))

  await sessionStore.init();
  app.use(sessionStore.middleware);

  app.get('/', (req, res) => {
    req.session.myCount = (req.session.myCount || 0) + 1
    req.session.save(() => {
      return res.json({
        success: true,
        message: "hello world!" + req.session.myCount
      });
    });
  })

  app.get('/destroy', (req, res) => {
    req.session.destroy(() => {
      return res.redirect('/');
    });
  })

  app.listen(3000, () => {
    const j = request.jar();
    const fn = request.defaults({ jar: true });
    let count = 100;
    const timer = setInterval(() => {
      if (count === 0) return clearInterval(timer);
      count--;
      fn({
        url: 'http://localhost:3000/',
        jar: j,
        removeRefererHeader: true,
        headers: {
          'Accept': 'Accept: text/*, application/json'
          //'Accept': 'jpeg'
        }
      }, function (err, res, body) {
        if (err) throw err;
        if (res.headers['set-cookie'] && res.headers['set-cookie'].length > 0) {
          const cookie = request.cookie(res.headers['set-cookie'][0]);
          j.setCookie(cookie);
        }
        console.log('requests:' + count)
      });
    }, 100);

  });
})()