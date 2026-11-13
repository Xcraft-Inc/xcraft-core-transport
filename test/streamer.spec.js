'use strict';

const {expect} = require('chai');
const Module = require('node:module');
const {PassThrough} = require('node:stream');
const Streamer = require('../lib/streamer.js');

function createStreamer(source, timeout = 20) {
  const response = {
    command: {send() {}},
    events: {
      send() {},
      subscribe() {
        return () => {};
      },
    },
    log: {warn() {}},
  };
  const originalLoad = Module._load;

  Module._load = function (request, parent, isMain) {
    if (request === 'xcraft-core-etc') {
      return () => ({load: () => ({streamer: {timeout}})});
    }
    if (request === 'xcraft-core-host') {
      return {getRoutingKey: () => 'local'};
    }
    if (request === 'xcraft-core-busclient') {
      return {getGlobal: () => ({newResponse: () => response})};
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const streamer = new Streamer('stream$test', source, false);
    streamer._send('remote');
    return streamer;
  } finally {
    Module._load = originalLoad;
  }
}

describe('xcraft.transport.streamer', function () {
  it('aborts the source when its transport socket closes', function () {
    const source = new PassThrough();
    const streamer = createStreamer(source);
    const controller = new AbortController();
    const reason = new Error('socket closed');

    streamer.bindTransportSignal(controller.signal);
    controller.abort(reason);
    streamer.abort(new Error('late timeout'));

    expect(streamer.signal.aborted).to.equal(true);
    expect(streamer.signal.reason).to.equal(reason);
    expect(source.destroyed).to.equal(true);
  });

  it('unbinds the transport signal after a normal completion', async function () {
    const source = new PassThrough();
    const streamer = createStreamer(source);
    let removeCount = 0;
    const signal = {
      aborted: false,
      addEventListener() {},
      removeEventListener() {
        ++removeCount;
      },
    };

    streamer.bindTransportSignal(signal);
    source.end(Buffer.from('chunk'));
    await new Promise((resolve) => setImmediate(resolve));

    expect(removeCount).to.equal(1);
    expect(streamer.signal.aborted).to.equal(false);
  });

  it('aborts instead of only clearing writes on a drain timeout', async function () {
    const source = new PassThrough();
    const streamer = createStreamer(source, 10);

    streamer.pause();
    source.write(Buffer.from('chunk'));
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(streamer.signal.aborted).to.equal(true);
    expect(streamer.signal.reason.message).to.equal(
      'streamer sender drain timeout'
    );
    expect(source.destroyed).to.equal(true);
  });
});
