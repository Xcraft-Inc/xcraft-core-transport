'use strict';

const {extractIds} = require('./helpers.js');

class Cache {
  constructor() {
    this._cache = {};
  }

  _loop(topic, predicate) {
    const ids = extractIds(topic);

    for (const id of ids) {
      for (const key in this._cache[id]) {
        if (key === '_size') {
          continue;
        }
        if (this._cache[id][key].test(topic)) {
          if (!predicate(id, key)) {
            return false;
          }
        }
      }
    }

    return true;
  }

  matches(topic) {
    return !this._loop(topic, () => false /* break after first match */);
  }

  map(topic, predicate) {
    const values = [];
    this._loop(topic, (id, key) => {
      values.push(predicate(id, key));
      return true; // continue
    });
    return values;
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
