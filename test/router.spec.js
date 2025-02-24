'use strict';

const {expect} = require('chai');
const Router = require('../lib/router.js');

const xLog = require('xcraft-core-log')('test', null);
xLog.setVerbosity(2);

const etc = require('xcraft-core-etc')();
const config = etc.load('xcraft-core-transport') || {};
config.backends = ['ee', 'axon'];
config.axon = {clientOnly: false};

describe('xcraft.transport.router', function () {
  describe('pushpull', function () {
    const server = new Router(null, 'pull', xLog);
    const clientEe = new Router(null, 'push', xLog);
    const clientAxon = new Router(null, 'push', xLog);

    it('start and connect', function (done) {
      let id = 'ee';

      server.on('message', (topic) => {
        expect(topic).to.be.eql(`test-${id}`);
        if (id !== 'ee') {
          clientEe.stop();
          clientAxon.stop();
          server.stop();
          done();
        }
      });

      server.start({host: '127.0.0.1', port: 3334}, () => {
        clientEe.connect('ee', {}, () => {
          clientEe.send('test-ee', {});
        });

        id = 'axon';
        clientAxon.connect('axon', {port: 3334, host: '127.0.0.1'}, () => {
          clientAxon.send('test-axon', {});
        });
      });
    });
  });

  describe('pubsub', function () {
    const server = new Router(null, 'pub', xLog);
    const clientEe = new Router(null, 'sub', xLog);
    const clientAxon = new Router(null, 'sub', xLog);

    it('subscribe and publish', function (done) {
      let cnt = 0;
      const _done = () => {
        ++cnt;
        if (cnt === 2) {
          clientEe.stop();
          clientAxon.stop();
          server.stop();
          done();
        }
      };

      let cnt2 = 0;
      const send = () => {
        ++cnt2;
        if (cnt2 === 2) {
          server.send('foobar', 'the message');
        }
      };

      server.start({host: '127.0.0.1', port: 3335}, () => {
        clientEe.subscribe('foobar');
        clientEe.on('message', (...args) => {
          expect(args.length).to.be.eql(2);
          expect(args[0]).to.be.eql('foobar');
          expect(args[1]).to.be.eql('the message');
          _done();
        });
        clientEe.connect('ee', {port: 3335, host: '127.0.0.1'}, () => send());

        clientAxon.subscribe('foobar');
        clientAxon.on('message', (...args) => {
          expect(args.length).to.be.eql(2);
          expect(args[0]).to.be.eql('foobar');
          expect(args[1]).to.be.eql('the message');
          _done();
        });
        clientAxon.connect('axon', {port: 3335, host: '127.0.0.1'}, () =>
          send()
        );
      });
    });
  });
});
