'use strict';

const moduleName = 'streamer';

const fs = require('fs');
const {Writable} = require('stream');
const EventEmitter = require('events');

class Streamer extends EventEmitter {
  constructor(streamId, stream) {
    super();

    this._send = this._send.bind(this);

    const busClient = require('xcraft-core-busclient').getGlobal();
    this._resp = busClient.newResponse(moduleName, 'token');
    this._streamId = streamId;

    if (stream) {
      /* Send a stream */
      this._stream = stream;

      this.on('send', this._send);

      const unsub = this._resp.events.subscribe(
        `*::${streamId}.stream.started`,
        () => {
          unsub();
          this.emit('send');
        }
      );
    } else {
      /* Receive a stream */
      const unsubChunked = this._resp.events.subscribe(
        `*::${streamId}.stream.chunked`,
        msg => {
          this.emit(
            'receive',
            msg.data.chunk,
            msg.data.current,
            msg.data.total
          );
        }
      );

      const unsubEnded = this._resp.events.subscribe(
        `*::${streamId}.stream.ended`,
        () => {
          this.emit('ended');
          unsubChunked();
          unsubEnded();
        }
      );
    }
  }

  _send() {
    let total = 0;
    let current = 0;

    if (this._stream instanceof fs.ReadStream) {
      const st = fs.statSync(this._stream.path);
      total = st.size;
    }

    const sender = new Writable({
      autoDestroy: true,
      write: (chunk, _, done) => {
        /* FIXME: needs multicast routing to prevent broadcast of chunks */
        current += chunk.length;
        this._resp.events.send(`${this._streamId}.stream.chunked`, {
          chunk,
          current,
          total,
        });
        done();
      },
    });

    this._stream.pipe(sender).on('finish', () => {
      this._resp.events.send(`${this._streamId}.stream.ended`);
    });
  }

  receive(stream, progress, next) {
    this.on('receive', (chunk, current, total) => {
      stream.write(chunk);
      if (progress) {
        progress(current, total);
      }
    }).on('ended', next);

    this._resp.events.send(`${this._streamId}.stream.started`);
  }
}

module.exports = Streamer;
