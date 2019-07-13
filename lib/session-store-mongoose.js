const uuid = require('uuid/v4');

const debug = require('debug');

const logger = debug('sessionstore');

module.exports = function (options) {
  function MongooseStore(opts) {
    this.opts = Object.assign({}, opts);
  }

  MongooseStore.prototype.init = async function () {
    try {
      const mongoose = this.opts.mongoose;

      const Schema = mongoose.Schema;

      const schema = new Schema({
        _id: { type: String, required: true, default: uuid }
      }, {
          id: false,
          strict: false,
          timestamps: true,
          versionKey: false,
          autoIndex: true
        });

      this.Model = mongoose.model('Session', schema, this.opts.collectionName);
      // await this.Model.syncIndexes();
      return true;
    } catch (error) {
      logger(error);
      throw error;
    }
  };

  MongooseStore.prototype.getSession = async function (id) {
    try {
      const session = await this.Model.findById(id).lean().exec();
      return session || false;
    } catch (error) {
      logger('getSession error: ' + error);
      return false;
    }
  };

  MongooseStore.prototype.createOrUpdateSession = async function (id, value) {
    try {
      const result = await this.Model.findOneAndReplace({ _id: id }, value, {
        upsert: true
      }).exec();
      return result._id;
    } catch (error) {
      logger('createOrUpdateSession error:' + error);
      return false;
    }
  };

  MongooseStore.prototype.destroySession = async function (id) {
    try {
      await this.Model.findByIdAndDelete(id).exec();
      return true;
    } catch (error) {
      logger('destroySession error: ' + error);
      return false;
    }
  };

  return new MongooseStore(options);
};
