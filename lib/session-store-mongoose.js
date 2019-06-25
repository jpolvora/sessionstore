const mongoose = require('mongoose');

mongoose.Promise = global.Promise;
mongoose.set('useNewUrlParser', true);
mongoose.set('useFindAndModify', false);
mongoose.set('useCreateIndex', true);

const schema = new mongoose.Schema({
  _key: { type: String, required: true, index: true },
  _hash: { type: String, required: true, index: true }
}, {
    strict: false,
    timestamps: false,
    versionKey: false
  });

function parseUri(uri) {
  const str1 = uri.split('//')[1];
  const str2 = str1.split(':');
  const user = str2[0];
  const str3 = str2[1].split('@');
  const pass = str3[0];
  const host = str3[1];
  const str5 = str2[2].split('/');
  const port = str5[0];
  const name = str5[1];
  return {
    host,
    name,
    port,
    user,
    pass
  }
}


module.exports = function (options) {
  function MongooseStore(opts) {
    this.opts = Object.assign({}, opts);
  }

  MongooseStore.prototype.init = async function () {
    try {
      const db = parseUri(this.uri);
      const connection = mongoose.createConnection(db.host, db.name, db.port, {
        user: db.user,
        pass: db.pass
      })

      //const connection = await mongoose.createConnection(this.uri);

      this.Model = connection.model('Session', schema, this.collectionName);
      return true;
    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  MongooseStore.prototype.getSession = async function (sessionKey) {
    try {
      const session = await this.Model.findOne({ _key: sessionKey }).lean().exec();
      return session || false;
    } catch (error) {
      console.error("getSession error: " + error);
      return false;
    }
  }

  MongooseStore.prototype.createOrUpdateSession = async function (key, value) {
    try {
      const result = await this.Model.findOneAndReplace({ _key: key }, value, {
        upsert: true,
        runValidators: false,
        setDefaultsOnInsert: true,
      }).exec();
      console.debug("createOrUpdateSession success: " + result)
    } catch (error) {
      console.error("createOrUpdateSession error:" + error)
    }
  }

  MongooseStore.prototype.destroySession = async function (sessionKey) {
    try {
      await this.Model.findOneAndDelete({ _key: sessionKey }).exec();
      return true;
    } catch (error) {
      console.error("destroySession error: " + error)
      return false;
    }
  }

  return new MongooseStore(options);
}