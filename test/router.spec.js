'use strict';

const {expect} = require('chai');
const Router = require('../lib/router.js');

const xLog = require('xcraft-core-log')('test', null);

describe('pushpull', function() {
  const server = new Router('pull', xLog);
  const clientEe = new Router('push', xLog);
  const clientAxon = new Router('push', xLog);

  it('#start and connect', function(done) {
    let id = 'ee';

    server.on('message', msg => {
      console.log(id);
      expect(msg).to.be.eql(`test-${id}`);
      if (id !== 'ee') {
        clientEe.stop();
        clientAxon.stop();
        server.stop();
        done();
      }
    });

    server.start({host: '127.0.0.1', port: 3334}, () => {
      clientEe.connect('ee', {}, () => {
        clientEe.send('test-ee');
      });

      id = 'axon';
      clientAxon.connect('axon', {port: 3334, host: '127.0.0.1'}, () => {
        clientAxon.send('test-axon');
      });
    });
  });
});

describe('pubsub', function() {
  const server = new Router('pub', xLog);
  const clientEe = new Router('sub', xLog);
  const clientAxon = new Router('sub', xLog);

  it('#subscribe and publish', function(done) {
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

    server.start({host: '127.0.0.1', port: 3335}, () => {
      clientEe.subscribe('foobar');
      clientEe.on('message', (...args) => {
        expect(args.length).to.be.eql(2);
        expect(args[0]).to.be.eql('foobar');
        expect(args[1]).to.be.eql('the message');
        _done();
      });
      clientEe.connect('ee', {});

      clientAxon.subscribe('foobar');
      clientAxon.on('message', (...args) => {
        expect(args.length).to.be.eql(2);
        expect(args[0]).to.be.eql('foobar');
        expect(args[1]).to.be.eql('the message');
        _done();
      });
      clientAxon.connect('axon', {port: 3335, host: '127.0.0.1'});

      server.send('foobar', 'the message');
    });
  });
});
