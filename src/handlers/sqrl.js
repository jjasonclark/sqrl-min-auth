'use strict';

const url = require('url');
const logger = require('pino')({ level: 'info' });
const get = require('dlv');
const querystring = require('querystring');
const base64url = require('universal-base64url');
const sqrlCrud = require('../lib/db/sqrl');
const nutCrud = require('../lib/db/nut');
const { signHmac } = require('../lib/hmac');
const { sign } = require('tweetnacl');

const apiBaseUrl = new url.URL(process.env.URL_BASE);

const isValidSignature = (message, signature, publicKey) => {
  try {
    return sign.detached.verify(
      Buffer.from(message),
      // Buffer.from(msg,'base64') decodes base64url format too
      Buffer.from(signature || '', 'base64'),
      Buffer.from(publicKey || '', 'base64')
    );
  } catch (ex) {
    logger.error(ex);
    return false;
  }
};

// TODO: handle just strings
const decodeSQRLPack = what =>
  what
    .split('\r\n')
    .reduce((memo, item) => Object.assign(memo, querystring.decode(item)), {});

// TODO: handle just string
const encodeSQRLPack = what =>
  Object.keys(what).reduce(
    (memo, key) => memo + `${key}=${what[key]}` + '\r\n',
    ''
  );

const verifySignature = (request, client) =>
  isValidSignature(
    String.prototype.concat(
      get(request, 'client', ''),
      get(request, 'server', '')
    ),
    get(request, 'ids', ''),
    client.idk
  );

const verifyPreviousSignature = (request, client) =>
  isValidSignature(
    String.prototype.concat(
      get(request, 'client', ''),
      get(request, 'server', '')
    ),
    get(request, 'pids', ''),
    client.pidk
  );

const isValidUnlock = (request, vuk) => {
  logger.debug({ request, vuk }, 'Checking unlock');
  const result = isValidSignature(
    String.prototype.concat(request.client, request.server),
    request.urs,
    vuk
  );
  logger.debug({ result }, 'Verify results');
  return result;
};

const formatReturn = clientReturn => {
  // TODO: don't mutate clientReturn
  clientReturn.tif = clientReturn.tif.toString(16);
  const rawReturn = encodeSQRLPack(clientReturn);
  return base64url.encode(rawReturn);
};

const createReturn = async clientReturn => {
  const body = formatReturn(clientReturn);
  if (clientReturn && clientReturn.nut !== clientReturn.code) {
    await nutCrud.updateHmac(clientReturn.nut, body);
  }
  const returnValue = {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      Expires: 'Mon, 01 Jan 1990 00:00:00 GMT',
      Pragma: 'no-cache',
      Vary: 'Origin',
      'Cache-control': 'no-cache',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': body.length.toString()
    },
    body
  };
  logger.info({ clientReturn }, 'Final return value');
  return returnValue;
};

const handler = async (event, context) => {
  logger.debug({ event, context }, 'Starting handler');
  const requestIp = get(event, 'requestContext.identity.sourceIp');
  const inputNut = get(event, 'queryStringParameters.nut');
  const domainName = apiBaseUrl.hostname;
  const path = `${apiBaseUrl.pathname}/sqrl`;
  const successUrl = `https://${domainName}${apiBaseUrl.pathname}/authenticate`;
  logger.debug({ requestIp, inputNut }, 'Request parameters');

  try {
    const body = get(event, 'body');
    const request = querystring.decode(body);
    const client = decodeSQRLPack(base64url.decode(get(request, 'client', '')));
    // TODO: Validate size of incoming body, request, and client
    // TODO: verify client param has required values such as idk
    // const server = base64url.decode(get(request, 'server', ''));

    const existingNut = await nutCrud.findNut(inputNut);

    logger.debug({ request, client, existingNut }, 'Decoded request');

    let clientReturn = { ver: 1, tif: 0 };

    // Do same IP check for every request
    // even if not requested to
    // If success mark return as success
    // Fail is covered when the nut is marked as invalid
    const sameIp = get(existingNut, 'ip') === requestIp;
    if (sameIp) {
      clientReturn.tif |= 0x04;
    }

    let validNut =
      // does exist
      existingNut &&
      // Not already used
      existingNut.used === null &&
      // Follow up nut's have same hmac
      (existingNut.nut === existingNut.code ||
        signHmac(get(request, 'server')) === existingNut.hmac);

    if (existingNut && !existingNut.used) {
      logger.debug({ existingNut, validNut }, 'Found unused nut; marking used');
      // TODO: verify this marked as used
      await nutCrud.markNutUsed(existingNut.nut);
    }

    // Generate next nut for reply
    if (validNut) {
      clientReturn.nut = await nutCrud.createFollowUpNut(
        requestIp,
        existingNut.code.toString().trim()
      );
    } else {
      clientReturn.nut = await nutCrud.createInitialNut(requestIp);
    }
    clientReturn.qry = `${path}?${querystring.encode({
      nut: clientReturn.nut
    })}`;

    try {
      if (!verifySignature(request, client)) {
        // Cannot process command
        clientReturn.tif |= 0x40 | 0x80;
        return await createReturn(clientReturn);
      }
      logger.debug('Signature verified');

      // Check IP if same ip check is requested
      validNut = validNut && (!client.opt.includes('noiptest') || sameIp);

      // look up user
      logger.debug({ client, clientReturn }, 'Looking up SQRL data');
      const sqrlData = await sqrlCrud.retrieve(client.idk);
      // Found current idk
      if (sqrlData) {
        sqrlData.idk = client.idk;
        logger.info({ client, sqrlData }, 'Found existing sqrl data');
        if (existingNut && !existingNut.user_id) {
          await nutCrud.markUser(existingNut.nut, sqrlData.user_id);
        } else {
          // user_id matches
          validNut =
            validNut && get(sqrlData, 'user_id') === existingNut.user_id;
        }
        await nutCrud.markUser(clientReturn.nut, sqrlData.user_id);
        if (sqrlData.superseded) {
          logger.info({ sqrlData }, 'Found a previously superseded idk');
          clientReturn.tif |= 0x200;
        } else {
          clientReturn.tif |= 0x01;
          if (!sqrlData.enabled) {
            clientReturn.tif |= 0x08;
          }
          // Did the client ask for suk values?
          if (client.opt.includes('suk')) {
            clientReturn.suk = sqrlData.suk;
          }
        }
      } else {
        logger.debug({ client }, 'Could not find sqrl data');
      }

      // All commands except query get url when CPS is requested
      if (client.cmd !== 'query' && client.opt.includes('cps')) {
        logger.debug('Returning CPS return url');
        clientReturn.url = `${successUrl}?${querystring.encode({
          code: validNut ? get(existingNut, 'code') : get(clientReturn, 'nut')
        })}`;
      }

      // Do not run any commands on invalid nuts
      if (!validNut) {
        logger.info({ existingNut }, 'Invalid nut');
        // something wrong with input nut
        // Cannot process command
        clientReturn.tif |= 0x40 | 0x20;
        return await createReturn(clientReturn);
      }
      logger.debug({ client, clientReturn }, 'Nut verified');

      // Initial nuts are only allowed to query
      if (client.cmd !== 'query' && existingNut.nut === existingNut.code) {
        clientReturn.tif |= 0x20;
        logger.debug(
          { client, existingNut },
          'Initial nut used for non-query command'
        );
        return await createReturn(clientReturn);
      }

      // Superseded idks can only use the query command
      if (client.cmd !== 'query' && clientReturn.tif & 0x200) {
        clientReturn.tif |= 0x40;
        logger.debug(
          { client, clientReturn },
          'Superseded idk used for non-query command'
        );
        return await createReturn(clientReturn);
      }

      // Process SQRL command
      logger.info({ client, clientReturn, sqrlData }, 'Processing command');
      switch (client.cmd) {
        case 'query':
          {
            if (sqrlData && !sqrlData.enabled) {
              // Add the suk value so user can enable account
              clientReturn.suk = sqrlData.suk;
              logger.info({ client, clientReturn }, 'Found disabled idk');
            } else if (client.pidk) {
              if (!verifyPreviousSignature(request, client)) {
                // Cannot process command
                clientReturn.tif |= 0x40 | 0x80;
                logger.info(
                  { client, clientReturn },
                  'Signature for pidk failed'
                );
              } else {
                logger.debug('Previous signature verified');
                const previousSqrl = await sqrlCrud.retrieve(client.pidk);
                if (!previousSqrl) {
                  // Cannot process command
                  clientReturn.tif |= 0x40;
                  logger.info({ client, clientReturn }, 'Unknown idk and pidk');
                } else {
                  await nutCrud.markUser(
                    clientReturn.nut,
                    previousSqrl.user_id
                  );
                  if (existingNut && !existingNut.user_id) {
                    await nutCrud.markUser(
                      existingNut.nut,
                      previousSqrl.user_id
                    );
                  }
                  if (previousSqrl.superseded) {
                    clientReturn.tif |= 0x200;
                  } else {
                    clientReturn.tif |= 0x02;
                    clientReturn.suk = sqrlData.suk;
                  }
                }
              }
            }
          }
          break;
        case 'ident':
          {
            if (sqrlData) {
              if (sqrlData.enabled) {
                // Set flags to current choices
                await sqrlCrud.update(sqrlData.idk, {
                  enabled: true,
                  hardlock: client.opt.includes('hardlock'),
                  sqrlonly: client.opt.includes('sqrlonly')
                });
                // Log in an account
                await nutCrud.markIdentified(
                  existingNut.code,
                  sqrlData.user_id
                );
                logger.info(
                  { client, clientReturn, sqrlData },
                  'Logging in user'
                );
              } else {
                if (isValidUnlock(request, sqrlData.vuk)) {
                  // reset disabled code
                  clientReturn.tif &= ~0x08;
                  // enable login
                  // Set flags to current choices
                  await sqrlCrud.update(sqrlData.idk, {
                    enabled: true,
                    hardlock: client.opt.includes('hardlock'),
                    sqrlonly: client.opt.includes('sqrlonly')
                  });
                  // Log in an account
                  await nutCrud.markIdentified(
                    existingNut.code,
                    sqrlData.user_id
                  );
                  logger.info(
                    { client, clientReturn, sqrlData },
                    'Logging in user'
                  );
                } else {
                  // Command failed
                  clientReturn.tif |= 0x40;
                  // Add the suk value so user can unlock
                  clientReturn.suk = sqrlData.suk;
                  logger.debug(
                    { client, clientReturn, sqrlData },
                    'Unlock signature failed'
                  );
                }
              }
            } else if (client.pidk) {
              if (!verifyPreviousSignature(request, client)) {
                // Cannot process command
                clientReturn.tif |= 0x40;
              } else {
                logger.debug(
                  'Previous signature verified; Attempting superseded'
                );
                const previousSqrl = await sqrlCrud.retrieve(client.pidk);
                if (!previousSqrl) {
                  clientReturn.tif |= 0x40;
                } else {
                  await nutCrud.markUser(
                    clientReturn.nut,
                    previousSqrl.user_id
                  );
                  if (existingNut && !existingNut.user_id) {
                    await nutCrud.markUser(
                      existingNut.nut,
                      previousSqrl.user_id
                    );
                  }
                  if (previousSqrl.superseded) {
                    clientReturn.tif |= 0x200 | 0x40;
                    logger.debug(
                      { client, clientReturn, previousSqrl },
                      'Previous idk has been superseded'
                    );
                  } else {
                    if (!isValidUnlock(request, previousSqrl.vuk)) {
                      clientReturn.tif |= 0x40;
                      logger.debug(
                        { client, clientReturn, previousSqrl },
                        'Previous idk unlock signature failed'
                      );
                    } else {
                      logger.info(
                        { client, previousSqrl },
                        'Creating new idk from previous account'
                      );
                      const success = await sqrlCrud.create({
                        idk: client.idk,
                        suk: client.suk,
                        vuk: client.vuk,
                        user_id: previousSqrl.user_id,
                        hardlock: client.opt.includes('hardlock'),
                        sqrlonly: client.opt.includes('sqrlonly')
                      });
                      if (!success) {
                        logger.debug(
                          { client, request },
                          'Could not create new idk'
                        );
                        clientReturn.tif |= 0x40;
                      } else {
                        // mark old idk as superseded
                        await sqrlCrud.supersede(client.pidk);
                        // Flag this is new idk
                        clientReturn.tif |= 0x01;
                        // Reset pidk flag
                        clientReturn.tif &= ~0x02;
                        // Log in an account
                        await nutCrud.markIdentified(
                          existingNut.code,
                          previousSqrl.user_id
                        );
                        logger.info(
                          { client, clientReturn, previousSqrl },
                          'Logging in user'
                        );
                      }
                    }
                  }
                }
              }
            } else {
              logger.info('Unknown user. Creating account');
              const userId = await sqrlCrud.create({
                idk: client.idk,
                suk: client.suk,
                vuk: client.vuk,
                hardlock: client.opt.includes('hardlock'),
                sqrlonly: client.opt.includes('sqrlonly')
              });
              if (userId) {
                clientReturn.tif |= 0x01;
                await nutCrud.markUser(clientReturn.nut, userId);
                if (existingNut && !existingNut.user_id) {
                  await nutCrud.markUser(existingNut.nut, userId);
                }
                await nutCrud.markIdentified(existingNut.code, userId);
              } else {
                logger.info({ client }, 'Could not create account');
                clientReturn.tif |= 0x40;
              }
            }
          }
          break;
        case 'enable':
          {
            if (!sqrlData || sqrlData.enabled) {
              clientReturn.tif |= 0x40 | 0x80;
              logger.debug(
                { client, clientReturn, sqrlData },
                'Cannot enable account'
              );
            } else if (isValidUnlock(request, sqrlData.vuk)) {
              // enable login
              // Set flags to current choices
              await sqrlCrud.update(sqrlData.idk, {
                enabled: true,
                hardlock: client.opt.includes('hardlock'),
                sqrlonly: client.opt.includes('sqrlonly')
              });
              // clear disabled bit
              clientReturn.tif &= ~0x08;
              // Log in an account
              await nutCrud.markIdentified(existingNut.code, sqrlData.user_id);
              logger.info(
                { client, clientReturn, sqrlData },
                'Logging in user'
              );
            } else {
              // Command failed
              clientReturn.tif |= 0x40;
              clientReturn.suk = sqrlData.suk;
              logger.info({ client, clientReturn }, 'Enable signature failed');
            }
          }
          break;
        case 'disable':
          {
            if (sqrlData && sqrlData.enabled) {
              // Set flags to current choices
              await sqrlCrud.update(sqrlData.idk, {
                enabled: false,
                hardlock: client.opt.includes('hardlock'),
                sqrlonly: client.opt.includes('sqrlonly')
              });
              logger.info(
                { userId: sqrlData.user_id },
                'Disabled sqrl login for user'
              );
              // Log in an account
              await nutCrud.markIdentified(existingNut.code, sqrlData.user_id);
              logger.info(
                { client, clientReturn, sqrlData },
                'Logging in user'
              );
            } else {
              logger.debug('Cannot disable account');
              // Command failed
              // Client should not have sent command without verifying the user first
              clientReturn.tif |= 0x40 | 0x80;
            }
          }
          break;
        case 'remove':
          {
            if (sqrlData && sqrlData.enabled) {
              logger.info(
                { idk: client.idk, userId: sqrlData.user_id },
                'Deleting sqrl'
              );
              // Delete login to user association
              await sqrlCrud.delete(client.idk);
              // Log in an account
              await nutCrud.markIdentified(existingNut.code, sqrlData.user_id);
              logger.info(
                { client, clientReturn, sqrlData },
                'Logging in user'
              );
            } else {
              logger.debug('Cannot remove account');
              // Command failed
              // Client should not have sent command without verifying the user first
              clientReturn.tif |= 0x40 | 0x80;
            }
          }
          break;
        default: {
          logger.debug({ cmd: client.cmd }, 'Unknown command');
          // Command failed
          // Client should not have sent command without verifying the user first
          clientReturn.tif |= 0x40 | 0x80;
        }
      }

      return await createReturn(clientReturn);
    } catch (ex) {
      clientReturn.tif |= 0x40 | 0x80;
      return await createReturn(clientReturn);
    }
  } catch (error) {
    logger.error(error);
    const nut = await nutCrud.createInitialNut(requestIp);
    const clientReturn = {
      ver: 1,
      nut,
      tif: 0x40 | 0x80,
      qry: `${path}?${querystring.encode({ nut })}`
    };
    return await createReturn(clientReturn);
  }
};

module.exports = { handler };
