'use strict;';
const EventEmitter = require('events');

const path = require('path');

const cache = require('memory-cache');

const uuid = require('uuid/v4');

const debug = require('debug');

const logger = debug('sessionstore');

const util = require('util');

const MemoryStore = require('./session-store-memory');

const MongooseStore = require('./session-store-mongoose');

if (process.env.DEBUG && process.env.DEBUG.indexOf('sessionstore') >= 0) {
  debug.enable('sessionstore');
}

const helpers = {
  serialize: function (obj) {
    return JSON.stringify(obj);
  },

  areEqual: function (src, target) {
    let serializedSrc = src || '';
    if (typeof src !== 'string') serializedSrc = helpers.serialize(src);
    let serializedTarget = target || '';
    if (typeof target !== 'string') serializedTarget = helpers.serialize(target);
    return serializedSrc === serializedTarget;
  },

  clone: function (obj) {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (error) {
      logger(error);
      return {};
    }
  }
};

const SessionStore = (function () {
  function SessionStore (opts = {}) {
    EventEmitter.call(this);

    this.cache = new cache.Cache();
    this.cache.debug(process.env.NODE_ENV !== 'production');

    this.opts = Object.assign({
      filter: ['text', 'html', 'json'],
      secret: null,
      store: {
        type: 'memory' /* memory|mongoose|custom */
      },
      allowedExtensions: [],
      rolling: false,
      cookie: {}
    }, opts);

    this.opts.cookie = Object.assign({
      name: 'session_id',
      // maxAge: 1000 * 60 * 60 * 24 * 7,// 1 day
      httpOnly: true,
      path: '/',
      secure: false,
      signed: true
    }, this.opts.cookie);

    this.opts.cookie.signed = true;
    this.inited = false;
  }

  SessionStore.prototype.init = async function () {
    if (this.inited) return;
    this.inited = true;
    if (!this.store) {
      const storeOpts = this.opts.store || {};
      const storeType = storeOpts.type || 'memory';
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
        // todo: implement custom stores
      }

      this.opts.store = storeOpts;
    }

    const success = await this.store.init();
    if (!success) throw new Error('Store could not be initialized.');
    this.emit('init');
  };

  SessionStore.prototype.initSessionData = function (res) {
    const self = this;
    const sessionData = {
      _id: false,
      _originalUrl: res.req.originalUrl, // url that initiated the request
      save: async function (cookieOpts) {
        sessionData._expired = false;
        await self.setSession.call(sessionData);
        ensureCookie.call(self, sessionData._id, res, cookieOpts);
      },
      destroy: async function () {
        if (!ensureCookie.call(self, sessionData._id, res, { expires: new Date(-1) })) {
          sessionData._expired = true;
          await self.setSession(sessionData);
        } else {
          await self.endSession(sessionData);
        }
      }
    };
    return sessionData;
  };

  function dummyCb (fn) {
    if (typeof fn === 'function') return fn.call(emptyObj);
  }

  const emptyObj = {
    save: dummyCb,
    destroy: dummyCb
  };

  function skipRequest (self, req) {
    try {
      if (req.session) return 'Session already fullfiled';

      if (Array.isArray(self.opts.allowedExtensions) && self.opts.allowedExtensions.length > 0) {
        const fileName = req.path;
        const extname = path.extname(fileName).replace('.', '');
        if (extname) {
          if (!self.opts.allowedExtensions.includes(extname)) {
            return 'Request do not accepts extension: ' + extname;
          }
        }
      }

      if (!req.accepts(self.opts.filter)) {
        return 'Request do not accepts filter: ' + util.inspect(self.opts.filter);
      }
    } catch (error) {
      return false;
    }
  }

  function ensureCookie (id, res, extraOpts) {
    try {
      // try catch in case of headersSent
      const self = this;
      const cookieOpts = Object.assign({}, self.opts.cookie, extraOpts);
      res.cookie(cookieOpts.name, id, cookieOpts);
      return true;
    } catch (error) {
      logger(error);
    }

    return false;
  }

  SessionStore.prototype.middleware = async function (req, res, next) {
    const self = this;
    if (!this.inited) throw new Error('SessionStore was not started. Call SessionStore.init()');

    const skipReason = skipRequest(self, req);
    if (skipReason) {
      logger(skipReason);
      return next();
    }

    req.session = emptyObj;

    const sessionData = self.initSessionData(res);
    const cookieValue = req.signedCookies[this.opts.cookie.name] || req.cookies[this.opts.cookie.name] || false;
    if (cookieValue) {
      let storedSession = self.cache.get(cookieValue);
      logger('cache hits: ' + self.cache.hits());
      logger('cache miss: ' + self.cache.misses());
      if (!storedSession) storedSession = await this.getSession(cookieValue);
      if (storedSession) {
        Object.assign(sessionData, storedSession, {
          _id: storedSession._id
        });
        self.cache.put(cookieValue, sessionData, 60 * 1000);
      } else {
        self.cache.del(cookieValue);
      }
    }

    if (!sessionData._id) {
      sessionData._id = uuid();
      await self.startSession(sessionData, res);
    }

    if (sessionData._expired) {
      ensureCookie.call(self, sessionData._id, res, { expired: new Date(-1) });
      await self.endSession.call(self, sessionData, res);
      return res.redirect(req.originalUrl);
    }

    if (self.opts.rolling === true) {
      ensureCookie.call(self, sessionData._id, res);
    }

    req.originalSessionData = helpers.serialize(sessionData);
    req.session = sessionData;

    createWriteHead.call(self, res, onHeaders);

    return next();
  };

  function createWriteHead (res, onHeaders) {
    const self = this;
    const _writeHead = res.writeHead;
    res.writeHead = function () {
      onHeaders.call(self, res);
      res.writeHead = _writeHead;
      return _writeHead.apply(res, arguments);
    };
  }

  async function onHeaders (res) {
    const self = this;
    const req = res.req;
    const sessionData = req.session;
    const originalSessionData = req.originalSessionData;
    if (helpers.areEqual(sessionData, originalSessionData)) return;
    await self.setSession(sessionData);
  }

  /**
   * Generates a new session id and sets the response cookie
   * @param sessionData session object instance that will go through the request lifetime
   * @param res The function that sets the cookie into response
   * @emits session_started
   * @returns {void}
   *
   */
  SessionStore.prototype.startSession = async function (sessionData, res) {
    ensureCookie.call(this, sessionData._id, res);
    await this.setSession(sessionData);
    this.emit('session_started', helpers.clone(sessionData));
  };

  SessionStore.prototype.getSession = async function (id) {
    const storedSession = await this.store.getSession(id);
    return storedSession;
  };

  SessionStore.prototype.setSession = async function (sessionData) {
    const self = this;
    try {
      const cloned = helpers.clone(sessionData);
      delete cloned._loaded;
      const id = await self.store.createOrUpdateSession(sessionData._id, cloned);
      if (id) {
        sessionData._id = id;
        self.cache.put(id, sessionData, 60 * 1000);
        self.emit('session_stored', helpers.clone(sessionData));
      }
    } catch (error) {
      logger(error);
    }
  };

  SessionStore.prototype.endSession = async function (sessionData) {
    const self = this;
    self.cache.del(sessionData._id);
    await self.store.destroySession(sessionData._id);
    self.emit('session_destroyed', helpers.clone(sessionData));
  };

  util.inherits(SessionStore, EventEmitter);

  return SessionStore;
})();

module.exports = function (opts) {
  const sessionStore = new SessionStore(opts);
  sessionStore.middleware = sessionStore.middleware.bind(sessionStore);
  sessionStore.init = sessionStore.init.bind(sessionStore);
  return sessionStore;
};
