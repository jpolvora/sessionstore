const EventEmitter = require('events'),
  uuid = require('uuid/v4'),
  debug = require('debug')('sessionstore'),
  util = require('util'),
  MemoryStore = require('./session-store-memory'),
  MongooseStore = require('./session-store-mongoose')

const { serialize, areSameObject, clone } = {

  serialize: function (obj) {
    return JSON.stringify(obj);
  },

  areSameObject: function (src, target) {
    let serializedSrc = src || "";
    if (typeof src !== "string") serializedSrc = serialize(src);
    let serializedTarget = target || "";
    if (typeof target !== "string") serializedTarget = serialize(target);
    return serializedSrc === serializedTarget;
  },

  clone: function (obj) {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (error) {
      debug(error);
      throw error;
    }
  },
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
    this.stackCounter = {}
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

  SessionStore.prototype.initSessionData = function () {
    const self = this;
    const sessionData = {
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

  SessionStore.prototype.middleware = async function (req, res, next) {
    const self = this;

    await self.checkInit(); //

    const sessionData = self.initSessionData();

    const cookieValue = req.signedCookies[this.opts.cookie.name] || req.cookies[this.opts.cookie.name] || false;
    if (cookieValue) {
      const storedSession = await this.getSession(cookieValue);
      if (storedSession) {
        Object.assign(sessionData, storedSession, {
          uid: storedSession.uid
        });
      }
    }

    if (!sessionData.uid) {
      self.startSession(sessionData, res.cookie.bind(res));
    }

    req.originalSessionData = serialize(sessionData);
    req.session = sessionData;

    res.once('finish', async function () {
      const sessionData = req.session;
      const originalSessionData = req.originalSessionData;
      if (areSameObject(sessionData, originalSessionData)) return;

      await self.setSession(sessionData);
    })

    return next();
  }

  SessionStore.prototype.startSession = async function (sessionData, resCookie) {
    sessionData.uid = uuid();
    const cookieOpts = Object.assign({}, this.opts.cookie);
    resCookie(cookieOpts.name, sessionData.uid, cookieOpts);

    await this.setSession(sessionData);
    this.emit('session_started', sessionData);
  }

  SessionStore.prototype.getSession = async function (sessionKey) {
    const storedSession = await this.store.getSession(sessionKey);
    return storedSession;
  }

  SessionStore.prototype.setSession = async function (sessionData) {
    const self = this;
    try {
      const cloned = clone(sessionData);
      delete cloned._loaded;
      await self.store.createOrUpdateSession(sessionData.uid, cloned);
      self.emit('session_stored', sessionData);
    }
    catch (error) {
      debug(error);
    }
  }

  SessionStore.prototype.endSession = async function (sessionKey) {
    await this.store.destroySession(sessionKey);
    this.emit('session_destroyed', sessionKey);
  }

  util.inherits(SessionStore, EventEmitter);

  return SessionStore;
})();

module.exports = function (opts) {
  const sessionStore = new SessionStore(opts);
  sessionStore.middleware = sessionStore.middleware.bind(sessionStore);
  return sessionStore;
}