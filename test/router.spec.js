'use strict';

const {expect} = require ('chai');
const Router = require ('../lib/router.js');

const xLog = require ('xcraft-core-log') ('test', null);

describe ('', function () {
  const server = new Router ('pull', xLog);
  const clientEe = new Router ('push', xLog);
  const clientAxon = new Router ('push', xLog);

  it ('#', function (done) {
    let id = 'ee';

    server.on ('message', msg => {
      console.log (id);
      expect (msg).to.be.eql (`test-${id}`);
      if (id !== 'ee') {
        done ();
      }
    });

    server.start ({host: '127.0.0.1', port: 3334}, () => {
      clientEe.connect ('ee', {}, () => {
        clientEe.send ('test-ee');
      });

      id = 'axon';
      clientAxon.connect ('axon', {port: 3334, host: '127.0.0.1'}, () => {
        clientAxon.send ('test-axon');
      });
    });
  });
});
