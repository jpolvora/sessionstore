const EventEmitter = require('events'),
  cache = require('memory-cache'),
  uuid = require('uuid/v4'),
  debug = require('debug')('sessionstore'),
  util = require('util'),
  MemoryStore = require('./session-store-memory'),
  MongooseStore = require('./session-store-mongoose')

const helpers = {
  serialize: function (obj) {
    return JSON.stringify(obj);
  },

  areEqual: function (src, target) {
    let serializedSrc = src || "";
    if (typeof src !== "string") serializedSrc = helpers.serialize(src);
    let serializedTarget = target || "";
    if (typeof target !== "string") serializedTarget = helpers.serialize(target);
    return serializedSrc === serializedTarget;
  },

  clone: function (obj) {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (error) {
      debug(error);
      return {};
    }
  },
}

const queue = function () {
  this.promises = [];
}


const SessionStore = (function () {
  function SessionStore(opts = {}) {
    EventEmitter.call(this);

    this.opts = Object.assign({
      secret: null,
      store: {
        type: 'memory', /* memory|mongoose|custom */
      },
      cookie: {}
    }, opts)

    this.opts.cookie = Object.assign({
      name: 'session_id',
      //maxAge: 1000 * 60 * 60 * 24 * 7,// 1 day
      httpOnly: true,
      path: '/',
      secure: false,
      signed: true
    }, this.opts.cookie);

    this.opts.cookie.signed = true;
    this.init = false;
    this.locked = false;
    this.lockedCount = 0
  }

  SessionStore.prototype.checkInit = async function () {
    if (!!this.init) return;
    this.init = true;
    if (!this.store) {
      const storeOpts = this.opts.store || {};
      const storeType = storeOpts.type || "memory";
      if (storeType === 'memory') {
        this.store = new MemoryStore();
      } else if (storeType === 'mongoose') {
        const mongoose = storeOpts.mongoose;
        const collectionName = storeOpts.collectionName || '_sessions';
        this.store = new MongooseStore({
          mongoose: mongoose,
          collectionName: collectionName
        });
      } else {
        //todo: implement custom stores
      }

      this.opts.store = storeOpts;
    }

    const success = await this.store.init();
    if (!success) throw new Error("Store could not be initialized.");
  }

  SessionStore.prototype.initSessionData = function (url) {
    const self = this;
    const sessionData = {
      _originalUrl: url, //url that initiated the request
      save: async function (cb) {
        await self.setSession(this);
        return typeof cb === "function" && cb.call(this)
      },
      destroy: async function (cb) {
        await self.endSession(this.uid);
        return typeof cb === "function" && cb.call(this)
      }
    }
    return sessionData;
  }

  function unlock(self) {
    return new Promise((resolve) => {
      const i = setInterval(() => {
        if (self.lockedCount <= 5) {
          clearInterval(i);
          return resolve();
        }
      }, 1);
    })
  }

  SessionStore.prototype.middleware = async function (req, res, next) {
    const self = this;
    if (req.session) return next();
    await self.checkInit();
    self.lockedCount++;
    //console.debug('queue len before:' + self.lockedCount);
    //await unlock(self);
    //console.debug('queue len after :' + self.lockedCount);
    const sessionData = self.initSessionData(req.originalUrl);
    const cookieValue = req.signedCookies[this.opts.cookie.name] || req.cookies[this.opts.cookie.name] || false;
    if (cookieValue) {
      let storedSession = cache.get(cookieValue);
      if (storedSession && storedSession.uid === cookieValue) {
        console.debug('cache hit: ' + cookieValue);
      }
      if (!storedSession) storedSession = await this.getSession(cookieValue);
      if (storedSession) {
        Object.assign(sessionData, storedSession, {
          uid: storedSession.uid
        });
        cache.put(cookieValue, sessionData, 5000);
      }
    }

    if (!sessionData.uid) {
      sessionData.uid = uuid();
      cache.put(sessionData.uid, sessionData, 5000);
      await self.startSession(sessionData, res.cookie.bind(res));
    }

    req.originalSessionData = helpers.serialize(sessionData);
    req.session = sessionData;

    createWriteHead.call(self, res, onHeaders);
    self.lockedCount--;
    return next();
  }

  function createWriteHead(res, onHeaders) {
    const self = this;
    const _writeHead = res.writeHead;
    res.writeHead = function () {
      onHeaders.call(self, res);
      res.writeHead = _writeHead;
      return _writeHead.apply(res, arguments);
    }
  }

  async function onHeaders(res) {
    const self = this;
    const req = res.req;
    const sessionData = req.session;
    const originalSessionData = req.originalSessionData;
    if (helpers.areEqual(sessionData, originalSessionData)) return;

    cache.put(sessionData.uid, sessionData, 5000);
    await self.setSession(sessionData);
  }

  /**
   * Generates a new session uid and sets the response cookie
   * @param sessionData session object instance that will go through the request lifetime
   * @param resCookie The function that sets the cookie into response
   * @emits session_started
   * @returns {void}
   * 
   */
  SessionStore.prototype.startSession = async function (sessionData, resCookie) {
    const cookieOpts = Object.assign({}, this.opts.cookie);
    resCookie(cookieOpts.name, sessionData.uid, cookieOpts);

    await this.setSession(sessionData);
    this.emit('session_started', helpers.clone(sessionData));
  }

  SessionStore.prototype.getSession = async function (uid) {
    const storedSession = await this.store.getSession(uid);
    return storedSession;
  }

  SessionStore.prototype.setSession = async function (sessionData) {
    const self = this;
    try {
      const cloned = helpers.clone(sessionData);
      delete cloned._loaded;
      await self.store.createOrUpdateSession(sessionData.uid, cloned);
      self.emit('session_stored', helpers.clone(sessionData));
    }
    catch (error) {
      debug(error);
    }
  }

  SessionStore.prototype.endSession = async function (sessionData) {
    await this.store.destroySession(sessionData.uid);
    this.emit('session_destroyed', helpers.clone(sessionData));
  }

  util.inherits(SessionStore, EventEmitter);

  return SessionStore;
})();

module.exports = function (opts) {
  const sessionStore = new SessionStore(opts);
  sessionStore.middleware = sessionStore.middleware.bind(sessionStore);
  return sessionStore;
}