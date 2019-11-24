'use strict';

const url = require('url');
const get = require('dlv');
const cookie = require('cookie');
const cookieSignature = require('cookie-signature');
const {
  cookie: { secret: cookieSecret }
} = require('../../secrets.json');
const commonParams = {
  secure: true,
  httpOnly: true,
  sameSite: 'strict'
};
const propName = 'user';
const cookieTimeout = 2 * 7 * 24 * 60 * 60; // 2 weeks in seconds

const getUserCookie = cookies => {
  const signed = get(cookie.parse(cookies || ''), propName);
  return signed ? cookieSignature.unsign(signed, cookieSecret) : false;
};

const createUserCookie = (userId, site) => {
  const apiBaseUrl = new url.URL(site);
  return cookie.serialize(
    propName,
    cookieSignature.sign(userId.toString(), cookieSecret),
    {
      ...commonParams,
      path: apiBaseUrl.pathname,
      domain: apiBaseUrl.hostname,
      expires: new Date(Date.now() + cookieTimeout * 1000)
    }
  );
};

const clearUserCookie = site => {
  const apiBaseUrl = new url.URL(site);
  return cookie.serialize(propName, '', {
    ...commonParams,
    path: apiBaseUrl.pathname,
    domain: apiBaseUrl.hostname,
    expires: new Date('Sun, 06 Nov 1994 08:49:37 GMT')
  });
};

module.exports = { getUserCookie, createUserCookie, clearUserCookie };
