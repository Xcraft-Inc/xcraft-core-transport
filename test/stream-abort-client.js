'use strict';

const {Writable} = require('node:stream');
const xBusClient = require('xcraft-core-busclient');

function connect(client) {
  return new Promise((resolve, reject) => {
    client.connect('axon', null, (err) => (err ? reject(err) : resolve()));
  });
}

function consume({routingKey, xcraftStream}, onChunk) {
  let started = false;
  const destination = new Writable({
    write(chunk, encoding, callback) {
      if (!started) {
        started = true;
        onChunk();
      }
      callback();
    },
  });

  return new Promise((resolve, reject) => {
    xcraftStream.streamer(routingKey, destination, null, (err) =>
      err ? reject(err) : resolve()
    );
  });
}

async function run() {
  const remoteRoutingKey = 'stream-abort-client';
  const client = xBusClient.initGlobal();
  client._busConfig = {
    ...require('xcraft-core-etc')().load('xcraft-core-bus'),
    passive: true,
  };
  await connect(client);

  const resp = client.newResponse('stream-abort-test', client.getOrcName());
  const [first, second] = await Promise.all([
    resp.command.sendAsync('test-stream-goblin.open-stream', {
      id: process.env.STREAM_GOBLIN_ID,
      streamKey: 'first',
    }),
    resp.command.sendAsync('test-stream-goblin.open-stream', {
      id: process.env.STREAM_GOBLIN_ID,
      streamKey: 'second',
    }),
  ]);

  let started = 0;
  const onChunk = () => {
    if (++started === 2) {
      process.send({type: 'streaming'});
    }
  };

  Promise.all([
    consume({...first, routingKey: remoteRoutingKey}, onChunk),
    consume({...second, routingKey: remoteRoutingKey}, onChunk),
  ]).catch((err) => {
    process.send({
      type: 'error',
      error: err.stack || err.message || String(err),
    });
  });
  process.send({
    type: 'ready',
    routingKey: remoteRoutingKey,
    streamIds: [first.xcraftStream.streamId, second.xcraftStream.streamId],
  });
}

run().catch((err) => {
  process.send({
    type: 'error',
    error: err.stack || err.message || String(err),
  });
});
