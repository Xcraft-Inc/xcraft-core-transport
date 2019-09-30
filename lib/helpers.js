'use strict';

const {Readable} = require('stream');
const uuidV4 = require('uuid/v4');
const {isImmutable} = require('immutable');
const transit = require('transit-immutable-js');
const Shredder = require('xcraft-core-shredder');

class Helpers {
  static extractIds(topic) {
    const regex = /([^.:]+@[^.:]+|\.[a-z0-9]+-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+\.)/g;
    let match;
    const res = [];
    while ((match = regex.exec(topic))) {
      res.unshift(match[0]);
    }
    res.unshift('_');
    return res;
  }

  static _immutableToJSON(data) {
    if (!data) {
      return {data, type: 'Object'};
    }

    if (isImmutable(data)) {
      const n = transit.toJSON(data);
      return {data: n, type: 'Immutable'};
    }

    if (data._isSuperReaper6000) {
      const n = transit.toJSON(data.state);
      return {data: n, type: 'Shredder'};
    }

    return {data, type: 'Object'};
  }

  static _wrap(type, data) {
    return type === 'Shredder' ? new Shredder(data) : data;
  }

  static dataToXcraftJSON(d) {
    /* Handle immutable d.data payload */
    const imm = Helpers._immutableToJSON(d.data);
    if (imm.type !== 'Object') {
      const n = Object.assign({}, d);

      if (!n[`_xcraft${imm.type}`]) {
        n[`_xcraft${imm.type}`] = {};
      }
      n[`_xcraft${imm.type}`]['.'] = imm.data;
      n.data = null;

      return n;
    }

    /* Continue because it's not immutable */

    const isArray = Array.isArray(d.data);

    /* Handle immutable d.data[keys] payloads */
    if (typeof d.data === 'object') {
      let n = null;

      for (const key in d.data) {
        const imm = Helpers._immutableToJSON(d.data[key]);
        if (!n) {
          n = Object.assign({}, d);
          n.data = isArray ? [] : {};
        }

        if (imm.type !== 'Object') {
          if (!n[`_xcraft${imm.type}`]) {
            n[`_xcraft${imm.type}`] = {};
          }
          n[`_xcraft${imm.type}`][key] = imm.data;
          n.data[key] = null;
        } else {
          n.data[key] = d.data[key];
        }

        if (key === 'data') {
          n.data = Helpers.dataToXcraftJSON(n.data);
        }
      }

      return n || d;
    }

    return d;
  }

  static tryStreamTo(msg, newStreamer) {
    if (!msg.data) {
      return;
    }

    if (msg._xcraftStream) {
      if (msg.data.xcraftStream.getStream) {
        newStreamer(
          msg.data.xcraftStream.streamId,
          msg.data.xcraftStream.getStream()
        );
      }
      return;
    }

    let stream = null;
    if (msg.data instanceof Readable) {
      stream = msg.data;
    } else if (msg.data.xcraftStream) {
      stream = msg.data.xcraftStream;
    }

    if (!stream) {
      return;
    }

    const streamId = uuidV4();
    msg.data.xcraftStream = {streamId};
    msg._xcraftStream = true;
    newStreamer(streamId, stream);
  }

  static toXcraftJSON(args, newStreamer = null) {
    args = Array.isArray(args) ? args : [args];

    return args.map(d => {
      if ((!d._xcraftMessage && !d._xcraftIPC) || !d.data) {
        return d;
      }

      Helpers.tryStreamTo(d, newStreamer);
      return Helpers.dataToXcraftJSON(d);
    });
  }

  static dataFromXcraftJSON(d, root = false) {
    let n = null;

    /* Restore immutable payload */
    ['Immutable', 'Shredder'].forEach(type => {
      if (d[`_xcraft${type}`]) {
        if (!n) {
          n = Object.assign({}, d);
        }

        for (const key in d[`_xcraft${type}`]) {
          if (key === '.') {
            n.data = Helpers._wrap(
              type,
              transit.fromJSON(d[`_xcraft${type}`][key])
            );
          } else {
            n.data[key] = Helpers._wrap(
              type,
              transit.fromJSON(d[`_xcraft${type}`][key])
            );
          }
        }

        delete n[`_xcraft${type}`];
      }
    });

    if (n) {
      if (root) {
        n._xcraftRawMessage = d;
      }
      d = n;
    }

    if (d && d.data && d.data.data) {
      d.data = Helpers.dataFromXcraftJSON(d.data);
    }

    return d;
  }

  static fromXcraftJSON(args, newStreamer) {
    args = Array.isArray(args) ? args : [args];

    return args.map(d => {
      if (!d._xcraftMessage && !d._xcraftIPC) {
        return d;
      }

      if (d._xcraftStream) {
        d.data.xcraftStream = newStreamer(d.data.xcraftStream.streamId);
      }

      return Helpers.dataFromXcraftJSON(d, true);
    });
  }
}

module.exports = Helpers;
