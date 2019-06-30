function Queue (opts) {
  this.opts = {
    counter: opts.counter || 10
  };
}

Queue.prototype.unlock = function () {
  const self = this;
  return new Promise((resolve) => {
    const i = setInterval(() => {
      if (self.lockedCount <= 5) {
        clearInterval(i);
        return resolve();
      }
    }, 1);
  });
};

module.exports = Queue;
