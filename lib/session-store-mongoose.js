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


module.exports = function (options) {
  function MongooseStore(opts) {
    this.opts = Object.assign({}, opts);
  }

  MongooseStore.prototype.init = async function () {
    try {
      const connection = await mongoose.createConnection(this.opts.db.host, this.opts.db.name, this.opts.db.port, {
        user: this.opts.db.user,
        pass: this.opts.db.pass
      })

      this.Model = connection.model('Session', schema, this.opts.collectionName);
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