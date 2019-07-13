/** @format */
'use strict;'
const EventEmitter = require('events'),
  path = require('path'),
  cache = require('memory-cache'),
  uuid = require('uuid/v4'),
  debug = require('debug'),
  logger = debug('sessionstore'),
  util = require('util'),
  MemoryStore = require('./session-store-memory'),
  MongooseStore = require('./session-store-mongoose')

function sortObjByKey(value) {
  return typeof value === 'object'
    ? Array.isArray(value)
      ? value.map(sortObjByKey)
      : Object.keys(value)
          .sort()
          .reduce((o, key) => {
            const v = value[key]
            o[key] = sortObjByKey(v)
            return o
          }, {})
    : value
}

const helpers = {
  serialize: function(obj) {
    return (obj && JSON.stringify(sortObjByKey(obj))) || ''
  },

  areNotEquals: function(src, target) {
    let serializedSrc = src || ''
    if (typeof src !== 'string') {
      serializedSrc = helpers.serialize(src)
    }
    let serializedTarget = target || ''
    if (typeof target !== 'string') {
      serializedTarget = helpers.serialize(target)
    }
    return serializedSrc !== serializedTarget
  },

  clone: function(obj) {
    try {
      return JSON.parse(helpers.serialize(obj))
    } catch (error) {
      logger(error)
      return {}
    }
  }
}

const SessionStore = (function() {
  function SessionStore(opts = {}) {
    EventEmitter.call(this)

    this.cache = new cache.Cache()
    this.cache.debug(process.env.NODE_ENV !== 'production')

    this.opts = Object.assign(
      {
        filter: ['text', 'html', 'json'],
        secret: null,
        store: {
          type: 'memory' /* memory|mongoose|custom */
        },
        allowedExtensions: [],
        rolling: false,
        cookie: {}
      },
      opts
    )

    this.opts.cookie = Object.assign(
      {
        name: 'session_id',
        // maxAge: 1000 * 60 * 60 * 24 * 7,// 1 day
        httpOnly: true,
        path: '/',
        secure: false,
        signed: true
      },
      this.opts.cookie
    )

    this.opts.cookie.signed = true
    this.inited = false
  }

  SessionStore.prototype.init = async function() {
    if (this.inited) {
      return
    }
    this.inited = true
    if (!this.store) {
      const storeOpts = this.opts.store || {}
      const storeType = storeOpts.type || 'memory'
      if (storeType === 'memory') {
        this.store = new MemoryStore()
      } else if (storeType === 'mongoose') {
        const mongoose = storeOpts.mongoose
        const collectionName = storeOpts.collectionName || '_sessions'
        this.store = new MongooseStore({
          mongoose: mongoose,
          collectionName: collectionName
        })
      } else {
        // todo: implement custom stores
      }

      this.opts.store = storeOpts
    }

    const success = await this.store.init()
    if (!success) {
      throw new Error('Store could not be initialized.')
    }
    this.emit('init')
  }

  SessionStore.prototype.initSessionData = function(res) {
    const self = this
    const sessionData = {
      _id: false,
      _originalUrl: res.req.originalUrl, // url that initiated the request
      save: function(cookieOpts = {}) {
        cookieOpts.save = true
        res.req.session._expired = false
        res.req.session._isModified = true
        res.req.session._expires = cookieOpts.maxAge || null
        ensureCookie.call(self, res, cookieOpts)
        self.cache.put(res.req.session._id, res.req.session)
      },
      destroy: function() {
        res.req.session._expired = true
        res.req.session._isModified = true
        res.req.session._expires = new Date(-1)
        self.cache.put(res.req.session._id, res.req.session)
        const cookieOpts = {
          destroy: true,
          expires: new Date(-1)
        }
        ensureCookie.call(self, res, cookieOpts)
      }
    }
    return sessionData
  }

  function dummyCb(fn) {
    if (typeof fn === 'function') {
      return fn.call(emptyObj)
    }
  }

  const emptyObj = {
    save: dummyCb,
    destroy: dummyCb
  }

  function skipRequest(self, req) {
    try {
      if (req.session) {
        return 'Session already fullfiled'
      }

      if (Array.isArray(self.opts.allowedExtensions) && self.opts.allowedExtensions.length > 0) {
        const fileName = req.path
        const extname = path.extname(fileName).replace('.', '')
        if (extname) {
          if (!self.opts.allowedExtensions.includes(extname)) {
            return 'Request do not accepts extension: ' + extname
          }
        }
      }

      if (!req.accepts(self.opts.filter)) {
        return 'Request do not accepts filter: ' + util.inspect(self.opts.filter)
      }
    } catch (error) {}
    return false
  }

  function ensureCookie(res, extraOpts = {}) {
    try {
      console.log('called ensurecookie')
      const sessionData = res.req.session
      // try catch in case of headersSent
      const self = this
      const cookieOpts = Object.assign(
        {},
        self.opts.cookie,
        {
          maxAge: res.req.session._expires
        },
        extraOpts
      )
      if (!cookieOpts.maxAge) {
        delete cookieOpts.maxAge
      }
      sessionData._cookiePending = true
      sessionData._updateCookie = function() {
        try {
          if (res.headersSent) {
            return false
          }
          res.cookie(cookieOpts.name, sessionData._id, cookieOpts)
          sessionData._cookiePending = false
          sessionData._updateCookie = undefined
        } catch (error) {
          logger(error)
        }
      }
      if ((extraOpts && extraOpts.save) || extraOpts.destroy) {
        return sessionData._updateCookie()
      }
      return true
    } catch (error) {
      logger(error)
      return false
    }
  }

  SessionStore.prototype.middleware = async function(req, res, next) {
    const self = this
    if (!this.inited) {
      throw new Error('SessionStore was not started. Call SessionStore.init()')
    }

    const skipReason = skipRequest(self, req)
    if (skipReason) {
      logger(skipReason)
      return next()
    }

    req.session = emptyObj

    const sessionData = self.initSessionData(res)
    const cookieValue = req.signedCookies[this.opts.cookie.name] || req.cookies[this.opts.cookie.name] || false
    let loaded = undefined
    if (cookieValue) {
      const cachedSession = self.cache.get(cookieValue)
      if (cachedSession) {
        loaded = cachedSession
      } else {
        const storedSession = await this.getSession(cookieValue)
        if (storedSession) {
          loaded = storedSession
        }
      }
    }

    if (!loaded || loaded._expired) {
      self.cache.del(cookieValue)
      await self.setSession({
        _id: cookieValue,
        _isModified: true,
        _expired: true
      })
    } else if (loaded._id) {
      Object.assign(sessionData, loaded)
      self.cache.put(cookieValue, sessionData, 60 * 1000)
    }

    req.session = sessionData
    req.originalSessionData = helpers.serialize(sessionData)

    if (!sessionData._id) {
      sessionData._id = uuid()
      sessionData._isModified = true
      sessionData._expired = false
      ensureCookie.call(self, res)
      self.cache.put(sessionData._id, sessionData, 60 * 1000)
      self.emit('session_started', helpers.clone(sessionData))
    } else {
      if (self.opts.rolling === true) {
        ensureCookie.call(self, res)
        self.cache.put(cookieValue, sessionData, 60 * 1000)
      }
    }

    createWriteHead.call(self, res, onHeaders)

    return next()
  }

  function createWriteHead(res, onHeaders) {
    const self = this
    const _writeHead = res.writeHead
    res.writeHead = function() {
      const _args = arguments
      onHeaders.call(self, res, function() {
        res.writeHead = _writeHead
        return _writeHead.apply(res, _args)
      })
    }
  }

  async function onHeaders(res, cb) {
    const self = this
    const req = res.req
    const sessionData = req.session
    if (sessionData._cookiePending) {
      if (typeof sessionData._updateCookie === 'function') {
        sessionData._updateCookie.call(self)
      }
    }
    const originalSessionData = req.originalSessionData
    if (sessionData._isModified || !helpers.areNotEquals(sessionData, originalSessionData)) {
      sessionData._isModified = true
      await self.setSession(sessionData)
    }

    return cb()
  }

  SessionStore.prototype.getSession = async function(id) {
    const storedSession = await this.store.getSession(id)
    return storedSession
  }

  SessionStore.prototype.setSession = async function(sessionData) {
    const self = this
    if (!sessionData._isModified) {
      return
    }
    try {
      const cloned = helpers.clone(sessionData)
      delete cloned._cookiePending
      delete cloned._isModified
      if (cloned._expired) {
        await self.store.destroySession(cloned._id)
        self.cache.del(cloned._id)
        self.emit('session_destroyed', cloned)
      } else {
        await self.store.createOrUpdateSession(cloned._id, cloned)
        sessionData._isModified = false
        self.emit('session_stored', cloned)
      }
    } catch (error) {
      logger(error)
    }
  }

  util.inherits(SessionStore, EventEmitter)

  return SessionStore
})()

module.exports = function(opts) {
  const sessionStore = new SessionStore(opts)
  sessionStore.middleware = sessionStore.middleware.bind(sessionStore)
  sessionStore.init = sessionStore.init.bind(sessionStore)
  return sessionStore
}
