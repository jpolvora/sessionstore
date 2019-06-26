# sessionstore

## Session Store as middleware for express and Node

tested with node.js 10.x

```javascript
  npm install git: //github.com/jpolvora/sessionstore#commit
```

Initializing

```javascript
(async () {
    const mongoose = require('mongoose');

    /* requires mongoose connection */
    await mongoose.connect("mongodb://localhost/sessionstore-tests", {
        useNewUrlParser: true,
        useCreateIndex: true,
        useFindAndModify: true
    });

    const SessionStore = require('session-store')
    const app = express()

    /* requires cookie parser */
    app.use(cookieParser(process.env.SESSION_SECRET));

    const sessionStore = new SessionStore({
        secret: process.env.SESSION_SECRET,
        store: {
            type: 'mongoose',
            mongoose: mongoose //your working mongoose connection here
        }
    })

    /* not required: simple logger function */
    function log(eventName) {
        return (...args) => {
            console.debug(eventName, ...args);
        }
    }

    /*not required: listening to available events*/
    sessionStore.on('session_started', log('session_started'))
    sessionStore.on('session_stored', log('session_stored'))
    sessionStore.on('session_destroyed', log('session_destroyed'))
    await sessionStore.init();
    app.use(sessionStore.middleware);
})()
```

## Store Persistence

Currently there are 2 built-ins mechanism of persistence: `memory` or `mongoose` .
The `memory` persistence is for development only, not suitable for production environments.
The `mongoose` persistence is ready for production; 
You can insert your custom store into `sessionStore` instance by this way:

```
sessionStore.opts.store.type = 'custom'
sessionStore.store = youStoreInstance;
```

Just four methods must be implemented by your store:

```
module.exports = function() {
    return {
        init: async function() {
            return true;
        },

        getSession: async function(sessionKey) {
            const sessionData = {
                _id: uuid()
            }
            return sessionData;
        },

        createOrUpdateSession: async function(key, value) {
            return key;
        },

        destroySession: async function(key) {
            return true;
        }
    }
}
```

### See test.js in order to learn more about usage.

