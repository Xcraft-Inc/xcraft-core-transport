'use strict';

const moduleName = 'streamer';

const fs = require('fs');
const {Writable} = require('stream');
const EventEmitter = require('events');

class Streamer extends EventEmitter {
  constructor(streamId, stream, isUpload) {
    super();

    this._send = this._send.bind(this);

    const routingKey = require('xcraft-core-host').getRoutingKey();
    const busClient = require('xcraft-core-busclient').getGlobal();
    this._routingKey = routingKey;
    this._resp = busClient.newResponse(moduleName, 'token');
    this._streamId = streamId;
    this._isUpload = isUpload || false;

    if (stream) {
      /* Send a stream */
      this._stream = stream;

      this.on('send', this._send);

      const unsub = this._resp.events.subscribe(
        `*::<${streamId}>.stream.started`,
        (msg) => {
          unsub();
          this.emit('send', msg.data.routingKey);
        }
      );
    } else {
      /* Receive a stream */
      const unsubChunked = this._resp.events.subscribe(
        `*::<${streamId}>.stream.chunked`,
        (msg) => {
          this.emit(
            'receive',
            msg.data.chunk instanceof Buffer // FIXME: amp weird transform of this buffer?!
              ? msg.data.chunk
              : Buffer.from(msg.data.chunk.data),
            msg.data.current,
            msg.data.total
          );
        }
      );

      const unsubEnded = this._resp.events.subscribe(
        `*::<${streamId}>.stream.ended`,
        () => {
          this.emit('ended');
          unsubChunked();
          unsubEnded();
        }
      );
    }
  }

  _send(remoteRoutingKey) {
    let total = 0;
    let current = 0;

    if (this._stream instanceof fs.ReadStream) {
      const st = fs.statSync(this._stream.path);
      total = st.size;
    }

    const sender = new Writable({
      autoDestroy: true,
      write: (chunk, _, done) => {
        current += chunk.length;
        const data = {
          streamId: this._streamId,
          chunk,
          current,
          total,
        };
        if (this._isUpload || remoteRoutingKey === this._routingKey) {
          this._resp.command.send(
            `transport.${remoteRoutingKey}.emit-chunk`,
            data,
            done
          );
        } else {
          this._resp.events.send(`<${this._streamId}>.stream.chunked`, data);
          done();
        }
      },
    });

    this._stream.pipe(sender).on('finish', () => {
      if (this._isUpload || remoteRoutingKey === this._routingKey) {
        this._resp.command.send(`transport.${remoteRoutingKey}.emit-end`, {
          streamId: this._streamId,
        });
      } else {
        this._resp.events.send(`<${this._streamId}>.stream.ended`);
      }
    });
  }

  receive(remoteRoutingKey, stream, progress, next) {
    this.once('ended', next);
    this.on('receive', (chunk, current, total) => {
      stream.write(chunk);
      if (progress) {
        progress(current, total);
      }
    });

    if (this._routingKey === remoteRoutingKey) {
      this._resp.events.send(`<${this._streamId}>.stream.started`, {
        routingKey: remoteRoutingKey,
      });
    } else {
      this._resp.command.send(`transport.${remoteRoutingKey}.start-emit`, {
        streamId: this._streamId,
        routingKey: this._routingKey,
      });
    }
  }
}

module.exports = Streamer;
