'use strict';

const moduleName = 'streamer';

const fs = require('fs');
const {Writable} = require('stream');
const EventEmitter = require('events');

class Streamer extends EventEmitter {
  constructor(streamId, stream, isUpload) {
    super();

    this._send = this._send.bind(this);

    const {appId} = require('xcraft-core-host');
    const busClient = require('xcraft-core-busclient').getGlobal();
    this._appId = appId;
    this._resp = busClient.newResponse(moduleName, 'token');
    this._streamId = streamId;
    this._isUpload = isUpload || false;

    if (stream) {
      /* Send a stream */
      this._stream = stream;

      this.on('send', this._send);

      const unsub = this._resp.events.subscribe(
        `*::${streamId}.stream.started`,
        msg => {
          unsub();
          this.emit('send', msg.data.appId);
        }
      );
    } else {
      /* Receive a stream */
      const unsubChunked = this._resp.events.subscribe(
        `*::${streamId}.stream.chunked`,
        msg => {
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
        `*::${streamId}.stream.ended`,
        () => {
          this.emit('ended');
          unsubChunked();
          unsubEnded();
        }
      );
    }
  }

  _send(remoteAppId) {
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
        const data = {
          streamId: this._streamId,
          chunk,
          current,
          total,
        };
        if (this._isUpload || remoteAppId === this._appId) {
          this._resp.command.send(
            `transport.${remoteAppId}.emit-chunk`,
            data,
            done
          );
        } else {
          this._resp.events.send(`${this._streamId}.stream.chunked`, data);
          done();
        }
      },
    });

    this._stream.pipe(sender).on('finish', () => {
      if (this._isUpload || remoteAppId === this._appId) {
        this._resp.command.send(`transport.${remoteAppId}.emit-end`, {
          streamId: this._streamId,
        });
      } else {
        this._resp.events.send(`${this._streamId}.stream.ended`);
      }
    });
  }

  receive(remoteAppId, stream, progress, next) {
    this.on('receive', (chunk, current, total) => {
      stream.write(chunk);
      if (progress) {
        progress(current, total);
      }
    }).on('ended', next);

    if (this._appId === remoteAppId) {
      this._resp.events.send(`${this._streamId}.stream.started`, {
        appId: remoteAppId,
      });
    } else {
      this._resp.command.send(`transport.${remoteAppId}.start-emit`, {
        streamId: this._streamId,
        appId: this._appId,
      });
    }
  }
}

module.exports = Streamer;
