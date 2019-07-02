const express = require('express');
const request = require('request');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const SessionStore = require('./lib/session-store');
const debug = require('debug');
console.log('debug:', process.env.DEBUG);
const logger = debug('tests');
debug.enable('tests');
debug.enable('sessionstore');

const COLLECTION_NAME = '_sess';
(async () => {
  await mongoose.connect('mongodb://localhost/sessionstore-tests', {
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
    logger('error on droping collection', error);
  }

  const app = express();
  app.use(express.static('/favicon.ico'));
  app.use(cookieParser('mysecret'));
  const sessionStore = new SessionStore({
    allowedExtensions: ['html'],
    rolling: true,
    store: {
      type: 'mongoose',
      collectionName: COLLECTION_NAME,
      mongoose: mongoose // your working mongoose connection here
    }
  });

  /* not required: simple logger function */
  function log(eventName) {
    return (...args) => {
      return logger('sessionstore events:' + eventName, ...args);
    };
  }

  sessionStore.on('init', log('init'));
  sessionStore.on('session_started', log('session_started'));
  sessionStore.on('session_stored', log('session_stored'));
  sessionStore.on('session_destroyed', log('session_destroyed'));

  await sessionStore.init();
  app.use(sessionStore.middleware);

  app.get('/', async (req, res) => {
    req.session.myCount = (req.session.myCount || 0) + 1;
    await req.session.save(() => {

    });

    return res.json({
      success: true,
      message: 'hello world!' + req.session.myCount
    });
  });

  app.get('/destroy', async (req, res) => {
    await req.session.destroy(() => {
      return res.redirect('/');
    });
  });

  const sharedJar = request.jar();
  const createRequest = function (url, mustHasCookie) {
    return new Promise((resolve) => {
      let hasCookie = false;
      const req = request.defaults({ jar: true });
      return req({
        url: url,
        jar: sharedJar,
        removeRefererHeader: true,
        headers: {
          'Accept': 'Accept: text/*, application/json'
          // 'Accept': 'jpeg'
        }
      }, function (err, res) {
        if (err) {
          console.error(err);
        } else if (res.statusCode === 200) {
          if (res.headers['set-cookie'] && res.headers['set-cookie'].length > 0) {
            const cookie = request.cookie(res.headers['set-cookie'][0]);
            if (!hasCookie) {
              sharedJar.setCookie(cookie);
              console.log(cookie);
              hasCookie = true;
            }
          } else {
            console.log('response not cookie header for request ' + url);
            if (mustHasCookie) throw new Error('no cookie');
          }
        } else {
          console.log('status code !== 200');
        }
        return resolve();
      });
    });
  };

  function createFunction(url, i, cookie) {
    return () => createRequest(url + '?count=' + i, cookie);
  }

  async function executeRequests(count, url, cookie, paralel) {
    const functions = [];

    for (let i = 0; i < count; i++) {
      functions.push(createFunction(url, i, cookie));
    }

    if (paralel) {
      await Promise.all(functions.map(x => x()));
    } else {
      while (functions.length > 0) {
        const fn = functions.pop();
        await fn();
      }
    }
  }

  app.listen(3000, async () => {
    console.time('req');
    const paralel = false;
    await executeRequests(50, 'http://localhost:3000', true, paralel);
    await executeRequests(50, 'http://localhost:3000/index.html', true, paralel);
    await executeRequests(50, 'http://localhost:3000/index.md', false, paralel);
    console.timeEnd('req');
  });
})();
