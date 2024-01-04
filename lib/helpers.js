'use strict';

const {v4: uuidV4} = require('uuid');
const {isImmutable} = require('immutable');
const {stringify, parse} = require('xcraft-isomorphic-serialize');
const Shredder = require('xcraft-core-shredder');

const serializeOptions = {protocol: 1};
const idsCache = new Map();
const idsRegex = /([^<>.:]+@[^<>.:]+|\.[a-z0-9]+-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+\.|<[a-zA-Z.-]+>)/g;

class Helpers {
  static extractIds(topic) {
    if (idsCache.has(topic)) {
      return idsCache.get(topic);
    }

    idsRegex.lastIndex = 0;
    let match;
    const res = [];
    while ((match = idsRegex.exec(topic))) {
      switch (match[0][0]) {
        case '<':
          res.unshift(match[0]);
          break;
        case '.':
          res.push(match[0]);
          break;
        default:
          if (res.length - 2 > 0) {
            res.splice(res.length - 2, 0, match[0]);
          } else {
            res.push(match[0]);
          }
          break;
      }
    }
    res.unshift('_');

    /* Limit cache size to 4096 entries, remove the olders */
    idsCache.set(topic, res);
    if (idsCache.size > 4096) {
      const it = idsCache[Symbol.iterator]();
      for (let i = 128; i > 0; --i) {
        idsCache.delete(it.next().value[0]);
      }
    }

    return res;
  }

  static extractLineId(topic) {
    const feedStart = topic.indexOf('<');
    if (feedStart === -1) {
      return;
    }

    const feedStop = topic.indexOf('>', feedStart);
    if (feedStop === -1) {
      return;
    }

    return topic.substr(feedStart + 1, feedStop - feedStart - 1);
  }

  static _immutableToJSON(data) {
    if (!data) {
      return {data, type: 'Object'};
    }

    if (isImmutable(data)) {
      const n = stringify(data, serializeOptions);
      return {data: n, type: 'Immutable', xType: '_xImmu'};
    }

    if (data?._state?._isSuperReaper6000) {
      const n = stringify(data._state.state, serializeOptions);
      return {data: n, type: 'Shredder', xType: '_xShred'};
    }

    if (data._isSuperReaper6000) {
      const n = stringify(data.state, serializeOptions);
      return {data: n, type: 'Shredder', xType: '_xShred'};
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

      if (!n[imm.xType]) {
        n[imm.xType] = {};
      }
      n[imm.xType]['.'] = imm.data;
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
          if (!n[imm.xType]) {
            n[imm.xType] = {};
          }
          n[imm.xType][key] = imm.data;
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

  static _prepareStream(msg) {
    let stream;
    if (msg.data.xcraftUpload) {
      stream = msg.data.xcraftUpload;
    } else if (msg.data.xcraftStream) {
      stream = msg.data.xcraftStream;
    } else {
      return null;
    }

    if (Array.isArray(stream)) {
      /* Trick to skip webpack require discovering; note the use of a template string */
      const require = module[`require`].bind(module);
      const fs = require('fs');
      const path = require('path');
      const watt = require('gigawatts');
      const tar = require('tar-stream');

      const pack = tar.pack();

      watt(function* (next) {
        for (let entry of stream) {
          /* We accept an array of file path */
          if (typeof entry === 'string') {
            entry = {
              file: entry,
              name: path.basename(entry),
            };
          }

          let _stream = entry.file;
          if (typeof entry.file === 'string') {
            _stream = fs.createReadStream(entry.file);
            if (!entry.size) {
              entry.size = fs.statSync(entry.file).size;
            }
          }
          _stream.pipe(
            pack.entry(
              {
                name: entry.name,
                size: entry.size,
              },
              next
            )
          );
          yield;
        }

        pack.finalize();
      })();

      return pack;
    }

    if (typeof stream === 'string') {
      /* Trick to skip webpack require discovering; note the use of a template string */
      const require = module[`require`].bind(module);
      const fs = require('fs');
      return fs.createReadStream(stream);
    }

    return stream;
  }

  static tryStreamTo(msg, newStreamer) {
    if (!msg.data) {
      return;
    }

    if (msg._xcraftStream) {
      if (msg.data.xcraftStream.getStream) {
        newStreamer(
          msg.data.xcraftStream.streamId,
          msg.data.xcraftStream.getStream(),
          msg.data.xcraftStream.isUpload
        );
      }
      return;
    }

    const stream = Helpers._prepareStream(msg);
    const isUpload = !!msg.data.xcraftUpload;

    if (!stream) {
      return;
    }

    let streamId = `${msg.orcName}$`;
    if (msg.data.streamId) {
      streamId += msg.data.streamId ? msg.data.streamId : uuidV4();
    }
    msg.data.xcraftStream = {streamId, isUpload};
    msg._xcraftStream = true;
    newStreamer(streamId, stream, isUpload);
  }

  static toXcraftJSON(args, newStreamer = null) {
    args = Array.isArray(args) ? args : [args];

    return args.reduce((args, d) => {
      if ((!d._xcraftMessage && !d._xcraftIPC) || !d.data) {
        args.push(d);
        return args;
      }

      Helpers.tryStreamTo(d, newStreamer);

      /* Streamer stuff:
       * Here we move the buffer in a new arguments. If the chunk
       * stays in the message, there is a major overhead with AXON
       * because in this case the chunk is stringified just before
       * re-buffered. AXON knows how to optimise the serialization
       * while each sort of object is in a seperate argument.
       */
      let buffer;
      if (d.data && Buffer.isBuffer(d.data.chunk)) {
        buffer = d.data.chunk;

        /* Copy in order to prevent the mutation on the original message */
        d = {...d};
        d.data = {...d.data};

        d.data.chunk = null;
      }

      const arg = Helpers.dataToXcraftJSON(d);
      args.push(arg);
      if (buffer) {
        args.push(buffer);
      }
      return args;
    }, []);
  }

  static _dataFromImm(d, n, type, xType) {
    if (!d[xType]) {
      return n;
    }

    if (!n) {
      n = Object.assign({}, d);
    }

    for (const key in d[xType]) {
      if (key === '.') {
        n.data = Helpers._wrap(type, parse(d[xType][key], serializeOptions));
      } else {
        n.data[key] = Helpers._wrap(
          type,
          parse(d[xType][key], serializeOptions)
        );
      }
    }

    delete n[xType];
    return n;
  }

  static dataFromXcraftJSON(d, root = false) {
    let n = null;

    /* Restore immutable payloads */
    n = Helpers._dataFromImm(d, n, 'Immutable', '_xImmu');
    n = Helpers._dataFromImm(d, n, 'Shredder', '_xShred');

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

  static restoreChunkBuffer(args) {
    let chunkIndex = null;

    args = Array.isArray(args) ? args : [args];
    args = args.map((d, idx) => {
      if (!d._xcraftMessage && !d._xcraftIPC) {
        return d;
      }

      if (
        d.data &&
        Object.prototype.hasOwnProperty.call(d.data, 'chunk') &&
        d.data.chunk === null
      ) {
        chunkIndex = idx;
      }
      return d;
    });

    /* Streamer stuff:
     * Retrieve the chunk as buffer in the next argument and
     * restore the data.chunk value accordingly.
     */
    if (chunkIndex !== null) {
      args[chunkIndex].data.chunk = args[chunkIndex + 1];
      args.splice(chunkIndex + 1, 1);
    }

    return args;
  }

  static fromXcraftJSON(args, newStreamer) {
    args = Array.isArray(args) ? args : [args];

    args = args.map((d, idx) => {
      if (!d._xcraftMessage && !d._xcraftIPC) {
        return d;
      }

      if (newStreamer && d._xcraftStream) {
        d.data.xcraftStream = newStreamer(
          d.data.xcraftStream.streamId,
          null,
          d.data.xcraftStream.isUpload
        );
      }

      return Helpers.dataFromXcraftJSON(d, true);
    });

    return Helpers.restoreChunkBuffer(args);
  }
}

module.exports = Helpers;
