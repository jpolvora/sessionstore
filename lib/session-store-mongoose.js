const uuid = require('uuid/v4');

module.exports = function (options) {
  function MongooseStore(opts) {
    this.opts = Object.assign({}, opts);
  }

  MongooseStore.prototype.init = async function () {
    try {
      const mongoose = this.opts.mongoose,
        Schema = mongoose.Schema;

      const schema = new Schema({
        _id: { type: String, required: true, default: uuid },
      }, {
          id: false,
          strict: false,
          timestamps: true,
          versionKey: false,
          autoIndex: true
        });

      this.Model = mongoose.model('Session', schema, this.opts.collectionName);
      //await this.Model.syncIndexes();
      return true;
    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  MongooseStore.prototype.getSession = async function (id) {
    try {
      const session = await this.Model.findById(id).lean().exec();
      return session || false;
    } catch (error) {
      console.error("getSession error: " + error);
      return false;
    }
  }

  MongooseStore.prototype.createOrUpdateSession = async function (id, value) {
    try {
      const result = await this.Model.findByIdAndUpdate(id, value, {
        new: true,
        upsert: true,
        runValidators: false,
        setDefaultsOnInsert: true,
      }).exec();
      return result._id;
    } catch (error) {
      console.error("createOrUpdateSession error:" + error)
      return false;
    }
  }

  MongooseStore.prototype.destroySession = async function (id) {
    try {
      await this.Model.findByIdAndDelete(id).exec();
      return true;
    } catch (error) {
      console.error("destroySession error: " + error)
      return false;
    }
  }

  return new MongooseStore(options);
}