module.exports = function () {
  function MemoryStore () {
    this.sessions = {};
  }

  MemoryStore.prototype.init = async function () {
    return true;
  };

  MemoryStore.prototype.getSession = async function (sessionKey) {
    const result = this.sessions.hasOwnProperty(sessionKey) && this.sessions[sessionKey];
    if (!result) return false;
    try {
      return JSON.parse(result);
    } catch (error) {
      return false;
    }
  };

  MemoryStore.prototype.createOrUpdateSession = async function (key, value) {
    this.sessions[key] = JSON.stringify(value);
    return key;
  };

  MemoryStore.prototype.destroySession = async function (sessionKey) {
    delete this.sessions[sessionKey];
    return true;
  };

  MemoryStore.prototype.clear = async function () {
    for (const key in this.sessions) {
      if (this.sessions.hasOwnProperty(key)) {
        delete this.sessions[key];
      }
    }
  };

  return new MemoryStore();
};
