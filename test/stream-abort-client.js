'use strict';

const {Writable} = require('node:stream');
const xBusClient = require('xcraft-core-busclient');

function connect(client) {
  return new Promise((resolve, reject) => {
    client.connect('axon', null, (err) => (err ? reject(err) : resolve()));
  });
}

function consume({routingKey, xcraftStream}) {
  const destination = new Writable({
    write(chunk, encoding, callback) {
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
  const client = xBusClient.initGlobal();
  await connect(client);

  const resp = client.newResponse('stream-abort-test', 'token');
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

  consume(first).catch(() => {});
  consume(second).catch(() => {});
  process.send({type: 'streaming'});
}

run().catch((err) => {
  process.send({
    type: 'error',
    error: err.stack || err.message || String(err),
  });
});
