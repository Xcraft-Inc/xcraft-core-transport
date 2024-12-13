'use strict';

const path = require('path');
const xFs = require('xcraft-core-fs');
const xConfig = require('xcraft-core-etc')().load('xcraft');

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
  {
    type: 'checkbox',
    name: 'axon.clientOnly',
    message: 'only client connections (axon)',
    default: false,
  },
  {
    type: 'confirm',
    name: 'requestClientCert',
    message: 'request client certificates',
    default: false,
  },
  {
    type: 'input',
    name: 'certsPath',
    message: 'client certificates location',
    default: path.join(xConfig.xcraftRoot, 'var/certs'),
  },
  {
    type: 'input',
    name: 'keysPath',
    message: 'client private keys location',
    default: path.join(xConfig.xcraftRoot, 'var/keys'),
  },
];
