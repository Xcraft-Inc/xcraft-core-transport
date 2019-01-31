'use strict';

const {getRouters} = require('.');

const cmd = {};

cmd.status = function(msg, resp) {
  const status = getRouters().map(router => router.status());

  status.forEach((status, index) => {
    resp.log.info(`transport ${index}`);
    resp.log.info(`-> mode:${status.mode}`);
    Object.keys(status.backends).forEach(name => {
      const subs = Object.keys(status.backends[name].subscriptions);
      resp.log.info(`   [${name}] active:${status.backends[name].active}`);
      if (subs.length) {
        resp.log.info(`   [${name}] subscriptions:`);
      }
      subs.forEach(sub => {
        resp.log.info(`   -> ${sub}`);
      });
    });
  });

  resp.events.send('transport.status', status);
  resp.events.send(`transport.status.${msg.id}.finished`);
};

/**
 * Retrieve the list of available commands.
 *
 * @returns {Object} The list and definitions of commands.
 */
exports.xcraftCommands = function() {
  return {
    handlers: cmd,
    rc: {
      status: {
        parallel: true,
        desc: 'show the status of all transports',
      },
    },
  };
};
