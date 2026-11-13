'use strict';

const {expect} = require('chai');
const {EventEmitter} = require('node:events');
const Module = require('node:module');
const Axon = require('../lib/backends/axon.js');

function createAxon() {
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'xcraft-core-etc') {
      return () => null;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return new Axon('pub', {warn() {}});
  } finally {
    Module._load = originalLoad;
  }
}

describe('xcraft.transport.axon', function () {
  it('binds streamers to the lifecycle of their socket', function () {
    const backend = createAxon();
    const socket = new EventEmitter();
    let transportSignal;
    const streamer = {
      bindTransportSignal(signal) {
        transportSignal = signal;
      },
    };

    socket.destroyed = false;
    socket.writable = true;
    socket.write = () => true;
    backend._closed = false;
    backend._sock.socks.push(socket);

    backend.send('topic', () => {}, {
      context: {_xcraftStreamer: streamer},
    });

    expect(transportSignal.aborted).to.equal(false);
    socket.emit('close');
    expect(transportSignal.aborted).to.equal(true);
    expect(transportSignal.reason.message).to.equal('transport socket closed');
  });
});
