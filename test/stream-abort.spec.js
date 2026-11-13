'use strict';

const {expect} = require('chai');
const {fork} = require('node:child_process');
const path = require('node:path');
const {setTimeout: delay} = require('node:timers/promises');
const {Elf} = require('xcraft-core-goblin/lib/test.js');

async function waitFor(predicate, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out while waiting for the stream state');
    }
    await delay(20);
  }
}

function waitForChild(child, expectedType, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Child did not send ${expectedType}`)),
      timeout
    );

    const onExit = (code, signal) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Child exited before ${expectedType} (code: ${code}, signal: ${signal})`
        )
      );
    };
    const onMessage = (message) => {
      if (message.type === 'error') {
        clearTimeout(timer);
        child.off('exit', onExit);
        child.off('message', onMessage);
        reject(new Error(message.error));
      } else if (message.type === expectedType) {
        clearTimeout(timer);
        child.off('exit', onExit);
        child.off('message', onMessage);
        resolve(message);
      }
    };

    child.once('exit', onExit);
    child.on('message', onMessage);
  });
}

describe('xcraft.transport.stream-transport', function () {
  let runner;
  let requestClientCert;
  let transportConfig;

  this.beforeAll(function () {
    transportConfig = require('xcraft-core-etc')().load(
      'xcraft-core-transport'
    );
    requestClientCert = transportConfig.requestClientCert;
    transportConfig.requestClientCert = false;
    runner = new Elf.Runner();
    runner.init();
  });

  this.afterAll(function () {
    runner.dispose();
    transportConfig.requestClientCert = requestClientCert;
  });

  it('aborts all Goblin streams sharing a destroyed Axon socket', async function () {
    this.timeout(30000);
    let stage = 'waiting for the Goblin runner';

    const scenario = runner.it(async function () {
      stage = 'loading the stream test Goblin';
      const xBus = require('xcraft-core-bus');
      await xBus.loadModule(
        this.quest.resp,
        ['test-stream-goblin.js'],
        __dirname,
        {}
      );

      const streamModule = require('./test-stream-goblin.js');
      const sources = streamModule.getSources();
      const id = `test-stream-goblin@${this.quest.uuidV4()}`;
      const desktopId = 'system@stream-abort-test';
      const axon = xBus.getNotifier()._backends.get('axon');
      const existingSockets = new Set(axon._sock.socks);
      let child;
      let stdout = '';
      let stderr = '';

      streamModule.resetSources();
      stage = 'creating the stream test Goblin';
      await this.quest.create('test-stream-goblin', {id, desktopId});

      try {
        stage = 'starting the remote Axon client';
        child = fork(path.join(__dirname, 'stream-abort-client.js'), [], {
          env: {...process.env, STREAM_GOBLIN_ID: id},
          silent: true,
        });
        child.stdout.on('data', (data) => (stdout += data.toString()));
        child.stderr.on('data', (data) => (stderr += data.toString()));

        try {
          const {routingKey, streamIds} = await waitForChild(child, 'ready');
          for (const streamId of streamIds) {
            this.quest.resp.events.send(`stream.started.${streamId}.orcished`, {
              routingKey,
            });
          }
          await waitForChild(child, 'streaming');
        } catch (err) {
          err.message += `\nchild stdout:\n${stdout}\nchild stderr:\n${stderr}`;
          throw err;
        }
        stage = 'waiting for both stream sources';
        await waitFor(
          () =>
            sources.size === 2 &&
            Array.from(sources.values()).every((source) => source.chunks > 0)
        );

        const socket = axon._sock.socks.find(
          (candidate) => !existingSockets.has(candidate)
        );
        expect(socket, `child stderr:\n${stderr}`).to.not.equal(undefined);
        stage = 'destroying the shared Axon socket';
        socket.destroy();

        stage = 'waiting for both stream sources to abort';
        await waitFor(() =>
          Array.from(sources.values()).every((source) => source.destroyed)
        );

        expect(Array.from(sources.keys())).to.have.members(['first', 'second']);
        for (const source of sources.values()) {
          expect(source.destroyReason).to.be.an.instanceOf(Error);
          expect(source.destroyReason.message).to.equal(
            'transport socket closed'
          );
        }
      } finally {
        for (const source of sources.values()) {
          source.destroy();
        }
        if (child?.connected) {
          child.disconnect();
        }
        child?.kill();
        await this.quest.kill(id);
        streamModule.resetSources();
      }
    });

    await Promise.race([
      scenario,
      delay(20000).then(() => {
        throw new Error(`Integration scenario stuck while ${stage}`);
      }),
    ]);
  });
});
