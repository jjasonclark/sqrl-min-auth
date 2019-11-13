'use strict';

const get = require('dlv');
const { createHmac } = require('crypto');
const secrets = require('../../secrets.json');

const signHmac = message => {
  const crypt = createHmac('sha256', get(secrets, 'nuts.hmac'));
  crypt.update(message);
  return crypt.digest('base64');
};

module.exports = { signHmac };
