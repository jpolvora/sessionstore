const EventEmitter = require('events'),
  BCrypt = require('bcrypt'),
  uuid = require('uuid/v4'),
  debug = require('debug')('sessionstore'),
  util = require('util'),
  MemoryStore = require('./session-store-memory'),
  MongooseStore = require('./session-store-mongoose')

const { serialize, areNotSameObject, clone, generate, validate } = {

  serialize: function (obj) {
    return JSON.stringify(obj);
  },

  areNotSameObject: function (src, target) {
    let serializedSrc = src;
    if (typeof src !== "string") serializedSrc = serialize(src);
    let serializedTarget = target;
    if (typeof target !== "string") serializedTarget = serialize(target);
    return serializedSrc !== serializedTarget
  },

  clone: function (obj) {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (error) {
      debug(error);
      throw error;
    }
  },

  async generate() {
    try {
      const _key = uuid();
      const _salt = await BCrypt.genSalt(10);
      const _hash = await BCrypt.hash(_key, _salt);
      return { _key, _hash, _salt };
    } catch (error) {
      debug(error);
      throw error;
    }
  },

  async  validate(key, hash) {
    try {
      const success = await BCrypt.compare(key, hash);
      return success;
    } catch (error) {
      debug(error);
      return false;
    }
  }
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
      maxAge: 1000 * 60 * 60 * 24 * 7,// 1 day
      httpOnly: true,
      path: '/',
      secure: false
    }, this.opts.cookie);

    this.opts.cookie.signed = true;
    this.init = false;
  }

  SessionStore.prototype.checkInit = async function () {
    if (!!this.init) return;
    this.init = true;
    if (!this.store) {
      const opts = this.opts.store || {};
      const storeType = opts.type || "memory";
      opts.type = storeType;
      if (storeType === 'memory') {
        this.store = new MemoryStore();
      } else if (storeType === 'mongoose') {
        const mongoose = opts.mongoose;
        const collectionName = opts.collectionName || '_sessions';
        this.store = new MongooseStore({
          mongoose: mongoose,
          collectionName: collectionName
        });
      } else {
        //todo: implement custom stores
      }
    }

    const success = await this.store.init();
    if (!success) throw new Error("Store could not be initialized.");
  }

  SessionStore.prototype.middleware = async function (req, res, next) {
    const self = this;

    await self.checkInit(); //

    const sessionData = {
      _isNewSession: true,
      _isModified: false,
      _isValid: false,
      _key: false,
      _cookie: {},
      _url: req.originalUrl || "",
      save: async function (cb) {
        this._isModified = true;
        await self.setSession(this);
        return typeof cb === "function" && cb.call(this)
      },
      destroy: async function (cb) {
        this._isModified = true;
        this._destroyed = true;
        await self.setSession(this);
        return typeof cb === "function" && cb.call(this)
      }
    }

    const cookiesToInspect = req.signedCookies || req.cookies;
    if (cookiesToInspect) {
      const cookieValue = cookiesToInspect[this.opts.cookie.name] || false;
      if (cookieValue) {
        const storedSession = await this.getSession(cookieValue);
        if (storedSession && storedSession._key && storedSession._hash) {
          sessionData._isNewSession = false;
          const isValid = await validate(storedSession._key, storedSession._hash);
          if (isValid) {
            Object.assign(sessionData, storedSession, {
              _isValid: true,
              _isNewSession: false,
              _isModified: false,
              _key: storedSession._key,
              _hash: storedSession._hash
            });
          }
        }
      }
    }

    if (!sessionData.isValid) {
      await this.endSession(sessionData._key);
      sessionData._isNewSession = true;
    }

    if (sessionData._isNewSession) {
      await this.startSession(sessionData);

      const cookieOpts = Object.assign({}, this.opts.cookie);
      res.cookie(cookieOpts.name, sessionData._key, cookieOpts);
    }

    req.session = sessionData;
    this.originalSessionData = serialize(sessionData);

    res.once('finish', async function () {
      await self.setSession(sessionData);
    })

    res.once('end', async function () {
      await self.setSession(sessionData);
    })

    return next();
  }

  SessionStore.prototype.startSession = async function (sessionData) {
    const generated = await generate();
    Object.assign(sessionData, generated, {
      _isValid: true,
      _isNewSession: true,
      _isModified: false
    });
    this.emit('session_started', sessionData);
    return sessionData;
  }

  SessionStore.prototype.getSession = async function (sessionKey) {
    const storedSession = await this.store.getSession(sessionKey);
    return storedSession;
  }

  SessionStore.prototype.setSession = async function (sessionData) {
    const self = this;
    if (!sessionData._isModified) {
      //session.save can force modification without need to compare again.
      sessionData._isModified = areNotSameObject(this.originalSessionData, sessionData);
    }
    if (sessionData._isModified || sessionData._isNewSession) {
      sessionData._isModified = false;
      sessionData._isNewSession = false;
      try {
        if (sessionData._isDestroyed) {
          await self.store.createOrUpdateSession(cloned._key, { _hash: 'destroyed' });
        } else {
          const cloned = clone(sessionData);
          delete cloned._isModified;
          delete cloned._isNewSession;
          delete cloned._isValid;

          await self.store.createOrUpdateSession(cloned._key, cloned);
          self.emit('session_stored', cloned);
        }
      }
      catch (error) {
        debug(error);
      }
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
