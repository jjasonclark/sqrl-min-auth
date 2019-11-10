'use strict';

const logger = require('pino')({ level: 'debug' });
const crypto = require('crypto');
const util = require('util');
const base64url = require('universal-base64url');
const randomFill = util.promisify(crypto.randomFill);
const { nuts } = require('../../secrets.json');
const secrets = {
  key: Buffer.from(nuts.key, 'base64'),
  iv: Buffer.from(nuts.iv, 'base64')
};

// let counter = 213;
// const blowfishEncrypt = (message, { key, iv }) => {
//   const cipher = crypto.createCipheriv('bf-cbc', key, iv);
//   const encrypted = cipher.update(message.toString(), 'utf-8') + cipher.final();
//   return base64url.encode(encrypted);
// };

const lotsOfRandom = async ({ key, iv }) => {
  const randomBuffer = Buffer.alloc(17);
  await randomFill(randomBuffer);
  return base64url.encode(randomBuffer);
};

const createNut = async () => {
  try {
    // return blowfishEncrypt(++counter, secrets);
    return await lotsOfRandom(secrets);
  } catch (ex) {
    logger.error(ex);
    return '';
  }
};

module.exports = { createNut };
