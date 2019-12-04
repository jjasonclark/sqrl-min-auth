'use strict';

const logger = require('pino')({ level: 'info' });
const crypto = require('crypto');
const util = require('util');
const base64url = require('universal-base64url');
const randomFill = util.promisify(crypto.randomFill);
// const { nuts } = require('../../../secrets.json');
// const secrets = {
//   key: Buffer.from(nuts.key, 'base64'),
//   iv: Buffer.from(nuts.iv, 'base64')
// };

// const blowfishEncrypt = (message, { key, iv }) => {
//   const cipher = crypto.createCipheriv('bf-cbc', key, iv);
//   const encrypted = cipher.update(message, 'utf-8') + cipher.final();
//   return encrypted;
// };

const lotsOfRandom = async () => {
  const randomBuffer = Buffer.alloc(17);
  await randomFill(randomBuffer);
  return randomBuffer;
};

const createNut = async () => {
  try {
    const counter = await lotsOfRandom();
    // return base64url.encode(blowfishEncrypt(counter, secrets));
    return base64url.encode(counter);
  } catch (ex) {
    logger.error(ex);
    return '';
  }
};

module.exports = { createNut };
