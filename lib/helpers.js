'use strict';

module.exports = {
  extractIds: topic => {
    const regex = /[^.:]+@[^.:]+/g;
    let match;
    const res = [];
    while ((match = regex.exec(topic))) {
      res.unshift(match[0]);
    }
    res.unshift('_');
    return res;
  },
};
