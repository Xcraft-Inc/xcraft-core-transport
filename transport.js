'use strict';

const {getARP, getLines} = require('./lib/router.js');
const {getRouters} = require('.');

let appId = '$';
let tribe = '';
try {
  const xHost = require('xcraft-core-host');
  appId = xHost.appId;
  tribe = xHost.appArgs().tribe ? `-${xHost.appArgs().tribe}` : '';
} catch (ex) {
  if (ex.code !== 'MODULE_NOT_FOUND') {
    throw ex;
  }
}

const cmd = {};
const cmdNamespace = `${appId}${tribe}`;
const emitChunk = `${cmdNamespace}.emit-chunk`;
const emitEnd = `${cmdNamespace}.emit-end`;
const startEmit = `${cmdNamespace}.start-emit`;
const arp = `${cmdNamespace}.arp`;
const arpHordes = `${cmdNamespace}.arp.hordes`;
const lines = `${cmdNamespace}.lines`;

cmd[emitChunk] = function (msg, resp) {
  try {
    resp.events.send(`${msg.data.streamId}.stream.chunked`, msg.data);
    resp.events.send(`transport.${emitChunk}.${msg.id}.finished`);
  } catch (err) {
    resp.events.send(`transport.${emitChunk}.${msg.id}.error`, err);
  }
};

cmd[emitEnd] = function (msg, resp) {
  try {
    resp.events.send(`${msg.data.streamId}.stream.ended`);
    resp.events.send(`transport.${emitEnd}.${msg.id}.finished`);
  } catch (err) {
    resp.events.send(`transport.${emitEnd}.${msg.id}.error`, err);
  }
};

cmd[startEmit] = function (msg, resp) {
  try {
    resp.events.send(`${msg.data.streamId}.stream.started`, {
      appId: msg.data.appId,
    });
    resp.events.send(`transport.${startEmit}.${msg.id}.finished`);
  } catch (err) {
    resp.events.send(`transport.${startEmit}.${msg.id}.error`, err);
  }
};

cmd[arp] = function (msg, resp) {
  const _arp = getARP();
  const data = [];

  Object.entries(_arp)
    .map(([backend, orcNames]) => ({
      backend,
      orcNames,
    }))
    .forEach(({backend, orcNames}) => {
      Object.entries(orcNames).forEach(([orcName, route]) =>
        data.push({
          backend,
          orcName,
          id: route.id,
          token: route.token,
          port: route.port,
          hordes: route.hordes ? route.hordes.join(', ') : '',
        })
      );
    });

  resp.log.info('ARP routing entries');
  resp.log.info.table(data);

  resp.events.send(`transport.${arp}.${msg.id}.finished`);
};

cmd[arpHordes] = function (msg, resp) {
  const _arp = getARP();
  const data = [];

  Object.entries(_arp)
    .map(([backend, orcNames]) => ({
      backend,
      orcNames,
    }))
    .forEach(({backend, orcNames}) => {
      Object.entries(orcNames).forEach(([orcName, route]) => {
        let hordes = {};
        if (route.hordes) {
          hordes = route.hordes.reduce((state, horde) => {
            const len = horde.length / 2;
            state[horde] = new Array(len).join(' ') + 'X';
            return state;
          }, hordes);
        }
        data.push({
          backend,
          orcName,
          ...hordes,
        });
      });
    });

  resp.log.info('ARP hordes');
  resp.log.info.table(data);

  resp.events.send(`transport.${arpHordes}.${msg.id}.finished`);
};

cmd[lines] = function (msg, resp) {
  const _lines = getLines();
  const data = [];

  resp.log.info('Lines');
  Object.entries(_lines).forEach(([lineId, orcNames]) => {
    Object.entries(orcNames).forEach(([orcName, refcount]) => {
      data.push({
        lineId,
        orcName,
        refcount,
      });
    });
  });
  resp.log.info.table(data);
  resp.events.send(`transport.${lines}.${msg.id}.finished`);
};

cmd.status = function (msg, resp) {
  const status = getRouters().map((router) => router.status());

  status.forEach((status, index) => {
    resp.log.info(`transport ${index}`);
    resp.log.info(`-> mode:${status.mode}`);
    Object.keys(status.backends).forEach((name) => {
      const subs = Object.keys(status.backends[name].subscriptions);
      resp.log.info(`   [${name}] active:${status.backends[name].active}`);
      if (subs.length) {
        resp.log.info(`   [${name}] subscriptions:`);
      }
      subs.forEach((sub) => {
        resp.log.info(`   -> ${sub}`);
      });
    });
  });

  resp.events.send('transport.status', status);
  resp.events.send(`transport.status.${msg.id}.finished`);
};

cmd.xcraftMetrics = function (msg, resp) {
  const os = require('os');
  const metrics = {};

  try {
    /************************************************************************/

    /* ARP table */
    const arpKey = `${os.hostname()}.${cmdNamespace}.transport.arp`;
    const _arp = getARP();
    metrics[`${arpKey}.total`] = Object.keys(_arp).length;
    Object.entries(_arp).forEach(([backend, orcNames]) => {
      metrics[`${arpKey}.${backend}.orcNames.total`] = Object.keys(
        orcNames
      ).length;
      Object.entries(orcNames).forEach(([orcName, route]) => {
        metrics[`${arpKey}.${backend}.orcNames.${orcName}`] = {
          total: 1,
          labels: {
            token: route.token,
            hordes: route.hordes ? route.hordes.join(',') : '',
          },
        };
      });
    });

    /************************************************************************/

    /* Lines table */
    const linesKey = `${os.hostname()}.${cmdNamespace}.transport.lines`;
    const _lines = getLines();
    metrics[`${linesKey}.total`] = Object.keys(_lines).length;
    Object.entries(_lines).forEach(([lineId, orcNames]) => {
      metrics[`${linesKey}.${lineId}.orcNames.total`] = Object.keys(
        orcNames
      ).length;
      Object.entries(orcNames).forEach(([orcName, refcount]) => {
        metrics[`${linesKey}.${lineId}.orcNames.${orcName}.total`] = refcount;
      });
    });

    /************************************************************************/

    /* Routers */
    const routerKey = `${os.hostname()}.${cmdNamespace}.transport.routers`;
    const routers = getRouters();
    metrics[`${routerKey}.total`] = routers.length;
    routers.forEach((router) => {
      for (const [name, backend] of router._backends) {
        if (router.mode === 'sub') {
          metrics[`${routerKey}.${name}.${router.id}.subscriptions`] = {
            total: backend.subsSize,
            labels: {
              mode: router.mode,
              id: router.id,
            },
          };
        }
        if (backend._sock && backend._sock.socks) {
          metrics[`${routerKey}.${name}.socks.total`] =
            backend._sock.socks.length;
          for (const sock of backend._sock.socks) {
            const id =
              !sock.localPort && !sock.remotePort
                ? `X${sock._handle.fd}`
                : `L${sock.localPort}R${sock.remotePort}`;

            metrics[`${routerKey}.${name}.socks.${id}.bytesRead`] = {
              total: sock.bytesRead,
              labels: {
                mode: router.mode,
                type: backend._sock.type,
                id: router.id,
              },
            };
            metrics[`${routerKey}.${name}.socks.${id}.bytesWritten`] = {
              total: sock.bytesWritten,
              labels: {
                mode: router.mode,
                type: backend._sock.type,
                id: router.id,
              },
            };
          }
        }
      }
    });
  } finally {
    resp.events.send(`transport.xcraftMetrics.${msg.id}.finished`, metrics);
  }
};

/**
 * Retrieve the list of available commands.
 *
 * @returns {Object} The list and definitions of commands.
 */
exports.xcraftCommands = function () {
  return {
    handlers: cmd,
    rc: {
      [arp]: {
        parallel: true,
        desc: 'show the ARP table (summary)',
      },
      [arpHordes]: {
        parallel: true,
        desc: 'show the hordes list in the ARP table',
      },
      [lines]: {
        parallel: true,
        desc: 'show the lines table',
      },
      status: {
        parallel: true,
        desc: 'show the status of all transports',
      },
      [emitChunk]: {
        parallel: true,
        desc: 'request chunk emission in the streamer',
      },
      [emitEnd]: {
        parallel: true,
        desc: 'request end of streaming',
      },
      [startEmit]: {
        parallel: true,
        desc: 'request start streaming',
      },
      xcraftMetrics: {
        parallel: true,
        desc: 'extract transport Xcraft metrics',
      },
    },
  };
};
