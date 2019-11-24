'use strict';

const logger = require('pino')({ level: 'info' });
const { sign } = require('tweetnacl');
const get = require('dlv');

const createMessage = request =>
  String.prototype.concat(
    get(request, 'client', ''),
    get(request, 'server', '')
  );

const isValidSignature = (request, signature, publicKey) => {
  try {
    return sign.detached.verify(
      Buffer.from(createMessage(request)),
      // Buffer.from(msg,'base64') decodes base64url format too
      Buffer.from(signature || '', 'base64'),
      Buffer.from(publicKey || '', 'base64')
    );
  } catch (ex) {
    logger.error(ex);
    return false;
  }
};

module.exports = { isValidSignature };
