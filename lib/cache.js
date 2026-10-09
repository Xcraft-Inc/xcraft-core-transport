'use strict';

const {extractIds} = require('./helpers.js');

class Cache {
  constructor() {
    this._cache = new Map();
  }

  /* The idea is to check a regex only on a subset and not on the whole content
   * of the cache. For this, IDs are extracted from the topic. Then only the
   * regex of these IDs are considered (the loop over the ids).
   *
   * See matches() and map().
   */

  /**
   * Check if the topic matches at least one regex.
   *
   * @param {string} topic - Full command or event topic string.
   * @returns {boolean} true if the topic is matching.
   */
  matches(topic) {
    if (this._cache.size === 0) {
      return false;
    }

    const ids = extractIds(topic);

    /* The ids are visited from the most specific to the global one '_' */
    for (let i = ids.length - 1; i >= 0; --i) {
      const entries = this._cache.get(ids[i]);
      if (!entries) {
        continue;
      }

      /* break after first match */
      for (const regex of entries.values()) {
        regex.lastIndex = 0;
        if (regex.test(topic)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Map the cache and maps the values accordingly to a predicate.
   *
   * @param {string} topic - Full command or event topic string.
   * @param {function(id, key)} predicate - The new mapped value.
   * @returns {Array} the mapped values.
   */
  map(topic, predicate) {
    const values = [];

    if (this._cache.size === 0) {
      return values;
    }

    const ids = extractIds(topic);

    /* The ids are visited from the most specific to the global one '_' */
    for (let i = ids.length - 1; i >= 0; --i) {
      const id = ids[i];
      const entries = this._cache.get(id);
      if (!entries) {
        continue;
      }

      for (const [key, regex] of entries) {
        regex.lastIndex = 0;
        if (regex.test(topic)) {
          values.push(predicate(id, key));
        }
      }
    }

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
    if (!entries) {
      return;
    }
    entries.delete(key);
    if (entries.size === 0) {
      this._cache.delete(id);
    }
  }
}

module.exports = Cache;
