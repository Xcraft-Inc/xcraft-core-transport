'use strict';

class Cache {
  constructor() {
    this._cache = {};
  }

  matches(topic, ids) {
    for (const id of ids) {
      for (const key in this._cache[id]) {
        if (key === '_size') {
          continue;
        }
        if (this._cache[id][key].test(topic)) {
          return true;
        }
      }
    }
    return false;
  }

  clear() {
    this._cache = {};
  }

  set(id, key, value) {
    if (!this._cache[id]) {
      this._cache[id] = {_size: 1, [key]: value};
    } else {
      this._cache[id][key] = value;
      ++this._cache[id]._size;
    }
  }

  del(id, key) {
    if (this._cache[id]._size === 1) {
      delete this._cache[id];
    } else {
      delete this._cache[id][key];
      --this._cache[id]._size;
    }
  }
}

module.exports = Cache;
