module.exports = function (options) {
  function MongooseStore(opts) {
    this.opts = Object.assign({}, opts);
  }

  MongooseStore.prototype.init = async function () {
    try {
      const mongoose = this.opts.mongoose,
        Schema = mongoose.Schema;

      const schema = new Schema({
        _key: { type: String, required: true, index: true },
        _hash: { type: String, required: true, index: true }
      }, {
          strict: false,
          timestamps: false,
          versionKey: false
        });

      this.Model = mongoose.model('Session', schema, this.opts.collectionName);
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