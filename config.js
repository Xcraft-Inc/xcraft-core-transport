'use strict';

const path = require('path');
const xFs = require('xcraft-core-fs');

/**
 * Retrieve the inquirer definition for xcraft-core-etc
 */
module.exports = [
  {
    type: 'checkbox',
    name: 'backends',
    message: 'enabled backends (empty for all)',
    choices: xFs
      .ls(path.join(__dirname, 'lib/backends'), /\.js$/)
      .map((mod) => mod.replace(/\.js$/, '')),
    default: [],
  },
];
