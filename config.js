'use strict';

/**
 * Retrieve the inquirer definition for xcraft-core-etc
 */
module.exports = [
  {
    type: 'checkbox',
    name: 'backends',
    message: 'enabled backends (empty for all)',
    default: [],
  },
];
