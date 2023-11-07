'use strict';

const {extractIds} = require('./helpers.js');

class Cache {
  constructor() {
    this._cache = new Map();
  }

  /**
   * It's the main loop function for testing a topic.
   *
   * The idea is to check a regex only on a subset and not on the whole content
   * of the cache. For this, IDs are extracted from the topic. Then only the
   * regex of these IDs are considered (it's the first for loop).
   *
   * @param {string} topic - Full command or event topic string.
   * @param {function(id, key)} predicate - If returns false, the loop breaks.
   * @returns {boolean} false if broken by the predicate.
   */
  _loop(topic, predicate) {
    if (this._cache.size === 0) {
      return true;
    }

    const ids = extractIds(topic);

    for (let i = ids.length - 1; i >= 0; --i) {
      const id = ids[i];

      const entries = this._cache.get(id);
      if (!entries) {
        continue;
      }

      for (const [key, value] of entries) {
        if (value.test(topic)) {
          if (!predicate(id, key)) {
            return false;
          }
        }
      }
    }

    return true;
  }

  /**
   * Check if the topic matches at least one regex.
   *
   * @param {string} topic - Full command or event topic string.
   * @returns {boolean} true if the topic is matching.
   */
  matches(topic) {
    return !this._loop(topic, () => false /* break after first match */);
  }

  /**
   * Reduce the cache and maps the values accordingly to a predicate.
   *
   * @param {string} topic - Full command or event topic string.
   * @param {function(id, key)} predicate - The new mapped value.
   * @returns {Array} the mapped values.
   */
  map(topic, predicate) {
    const values = [];
    this._loop(topic, (id, key) => {
      values.push(predicate(id, key));
      return true; // continue
    });
    return values;
  }

  /**
   * Clear the whole cache.
   */
  clear() {
    this._cache.clear();
  }

  /**
   * Set a regex in the cache.
   *
   * @param {string} id - The id which can be available in a topic.
   * @param {string} key - The key for the regex (usually it's regex.toString).
   * @param {RegExp} value - The regex.
   */
  set(id, key, value) {
    if (!this._cache.has(id)) {
      this._cache.set(id, new Map([[key, value]]));
    } else {
      this._cache.get(id).set(key, value);
    }
  }

  /**
   * Delete an entry in the cache.
   *
   * @param {string} id - The id which can be available in a topic.
   * @param {string} key - The key for the regex (usually it's regex.toString).
   */
  del(id, key) {
    const entries = this._cache.get(id);
    entries.delete(key);
    if (entries.size === 0) {
      this._cache.delete(id);
    }
  }
}

module.exports = Cache;
