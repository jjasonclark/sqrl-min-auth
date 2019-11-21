'use strict';

const url = require('url');
const logger = require('pino')({ level: 'info' });
const get = require('dlv');
const querystring = require('querystring');
const base64url = require('universal-base64url');
const sqrlCrud = require('../lib/db/sqrl');
const nutCrud = require('../lib/db/nut');
const { createNut } = require('../lib/nut');
const { previousMessageHmac, signHmac } = require('../lib/hmac');
const { decodeSQRLPack, encodeSQRLPack } = require('../lib/sqrl-pack');
const { isValidSignature } = require('../lib/signature');

const nutTimeout = 60 * 60 * 1000; // 1 hour in ms
const apiBaseUrl = new url.URL(process.env.URL_BASE);
const successUrl = `${process.env.URL_BASE}/authenticate`;

const verifySignature = (request, { idk }) =>
  isValidSignature(request, request.ids, idk);

const verifyPreviousSignature = (request, { pidk }) =>
  isValidSignature(request, request.pids, pidk);

const isValidUnlock = (request, { vuk }) =>
  isValidSignature(request, request.urs, vuk);

const loginUser = async (sqrlData, client, existingNut) => {
  // Set flags to current choices
  await sqrlCrud.update(sqrlData.idk, {
    // enable login
    enabled: true,
    hardlock: client.opt.includes('hardlock'),
    sqrlonly: client.opt.includes('sqrlonly')
  });
  // Log in an account
  await nutCrud.update(
    existingNut.code,
    sqrlData.user_id,
    new Date().toISOString()
  );
  logger.info({ client, sqrlData }, 'Logging in user');
};

const httpResult = body => {
  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      Expires: 'Sun, 06 Nov 1994 08:49:37 GMT',
      Pragma: 'no-cache',
      Vary: 'Origin',
      'Cache-control': 'no-cache',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': body.length.toString()
    },
    body
  };
};

const convertToBody = clientReturn => {
  clientReturn.tif = clientReturn.tif.toString(16);
  const rawReturn = encodeSQRLPack(clientReturn);
  return base64url.encode(rawReturn);
};

const createFollowUpReturn = async (clientReturn, existingNut) => {
  // TODO: don't mutate clientReturn
  const nut = await createNut();
  clientReturn.nut = nut;
  clientReturn.qry = `${apiBaseUrl.pathname}/sqrl?${querystring.encode({
    nut
  })}`;
  const body = convertToBody(clientReturn);
  await nutCrud.create({ ...existingNut, nut, hmac: signHmac(body) });
  logger.info({ clientReturn }, 'Final return value');
  return httpResult(body);
};

const createErrorReturn = async (clientReturn, requestIp) => {
  // TODO: don't mutate clientReturn
  const nut = await createNut();
  await nutCrud.create({ nut, code: nut, ip: requestIp });
  clientReturn.nut = nut;
  clientReturn.qry = `${apiBaseUrl.pathname}/sqrl?${querystring.encode({
    nut
  })}`;
  const body = convertToBody(clientReturn);
  logger.info({ clientReturn }, 'Final return value');
  return httpResult(body);
};

const handler = async (event, context) => {
  logger.debug({ event, context }, 'Starting handler');
  const requestIp = get(event, 'requestContext.identity.sourceIp');
  const inputNut = get(event, 'queryStringParameters.nut');
  logger.debug({ requestIp, inputNut }, 'Request parameters');
  const body = get(event, 'body');

  try {
    const request = querystring.decode(body);
    const client = decodeSQRLPack(base64url.decode(get(request, 'client', '')));
    // TODO: Validate size of incoming body, request, and client
    // TODO: verify client param has required values such as idk
    // const server = base64url.decode(get(request, 'server', ''));
    logger.debug({ request, client }, 'Decoded request');

    const existingNut = await nutCrud.useNut(inputNut);
    if (
      // must have nut
      !existingNut ||
      // Follow up nut's have same hmac
      (existingNut.nut !== existingNut.code &&
        previousMessageHmac(request) !== existingNut.hmac) ||
      // nut created within timeout
      Date.now() - existingNut.created > nutTimeout
    ) {
      logger.debug({ client, existingNut }, 'Nut invalid');
      return await createErrorReturn({ ver: 1, tif: 0x20 }, requestIp);
    }
    logger.debug({ client, existingNut }, 'Nut verified');

    if (
      // valid signature
      !verifySignature(request, client) ||
      // valid previous signature
      (client.pidk && !verifyPreviousSignature(request, client))
    ) {
      logger.debug({ client, existingNut }, 'Signature or nut invalid');
      return await createErrorReturn({ ver: 1, tif: 0x40 | 0x80 }, requestIp);
    }
    logger.debug({ client, existingNut }, 'Signatures verified');

    // Do same IP check for every request
    // even if not requested to
    // If success mark return as success
    // Fail is covered when the nut is marked as invalid
    const sameIp = existingNut.ip === requestIp;

    if (
      // Check IP if same ip check is requested
      (!sameIp && client.opt.includes('noiptest')) ||
      // Initial nuts are only allowed to query
      (client.cmd !== 'query' && existingNut.nut === existingNut.code)
    ) {
      logger.debug({ client, existingNut }, 'Invalid nut via client actions');
      return await createErrorReturn({ ver: 1, tif: 0x20 | 0x80 }, requestIp);
    }

    // look up user
    const sqrlData = await sqrlCrud.retrieve(client.idk);
    logger.debug({ sqrlData }, 'Sqrl data lookup');
    if (sqrlData && !existingNut.user_id) {
      // This should only happen on the initial nut
      await nutCrud.update(existingNut.nut, sqrlData.user_id);
      existingNut.user_id = sqrlData.user_id;
    }

    // Follow up nut with existing accounts have same user ids
    if (
      existingNut.nut !== existingNut.code &&
      sqrlData &&
      sqrlData.user_id !== existingNut.user_id
    ) {
      logger.debug(
        { client, existingNut },
        'Invalid nut because different user id'
      );
      return await createErrorReturn({ ver: 1, tif: 0x20 | 0x80 }, requestIp);
    }

    const clientReturn = { ver: 1, tif: 0 };
    if (sameIp) {
      clientReturn.tif |= 0x04;
    }

    // Found current idk
    if (sqrlData) {
      logger.info(
        { client, existingNut, sqrlData },
        'Found existing sqrl data'
      );
      clientReturn.tif |= 0x01;
      if (!sqrlData.enabled) {
        clientReturn.tif |= 0x08;
      }
      if (sqrlData.superseded) {
        clientReturn.tif |= 0x200;
      }
      // Did the client ask for suk values?
      if (client.opt.includes('suk')) {
        clientReturn.suk = sqrlData.suk;
      }
    }

    if (
      // Superseded idks can only use the query command
      (client.cmd !== 'query' && sqrlData && sqrlData.superseded) ||
      // Pidks can only query and ident
      (client.pidk && !['query', 'ident'].includes(client.cmd))
    ) {
      logger.debug({ client, clientReturn, existingNut }, 'Cannot processes');
      clientReturn.tif |= 0x40 | 0x80;
      return await createErrorReturn(clientReturn, requestIp);
    }

    // Process SQRL command
    logger.info({ client, clientReturn, sqrlData }, 'Processing command');
    switch (client.cmd) {
      case 'query':
        if (sqrlData && !sqrlData.enabled) {
          // Add the suk value so user can enable account
          clientReturn.suk = sqrlData.suk;
          logger.info({ client, clientReturn }, 'Found disabled idk');
        }
        if (client.pidk) {
          const previousSqrl = await sqrlCrud.retrieve(client.pidk);
          if (previousSqrl) {
            logger.info({ client, clientReturn, previousSqrl }, 'Found pidk');
            if (!existingNut.user_id) {
              await nutCrud.update(existingNut.nut, previousSqrl.user_id);
              existingNut.user_id = previousSqrl.user_id;
            }
            clientReturn.tif |= 0x02;
            clientReturn.suk = sqrlData.suk;
          }
        }
        break;
      case 'ident':
        if (sqrlData) {
          if (sqrlData.enabled) {
            await loginUser(sqrlData, client, existingNut);
          } else {
            // Command failed
            clientReturn.tif |= 0x40;
            // Add the suk value so user can unlock
            clientReturn.suk = sqrlData.suk;
            logger.info(
              { client, clientReturn, sqrlData },
              'Ident failed on disabled account'
            );
          }
        } else if (client.pidk) {
          logger.debug('Previous signature verified; Attempting superseded');
          const previousSqrl = await sqrlCrud.retrieve(client.pidk);
          if (!previousSqrl) {
            clientReturn.tif |= 0x40;
          } else {
            if (!existingNut.user_id) {
              await nutCrud.update(existingNut.nut, previousSqrl.user_id);
              existingNut.user_id = previousSqrl.user_id;
            }
            if (previousSqrl.superseded) {
              clientReturn.tif |= 0x200 | 0x40;
              logger.debug(
                { client, clientReturn, previousSqrl },
                'Previous idk has been superseded'
              );
            } else if (!isValidUnlock(request, previousSqrl)) {
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
                logger.debug({ client, request }, 'Could not create new idk');
                clientReturn.tif |= 0x40;
              } else {
                // mark old idk as disabled and superseded
                await sqrlCrud.update(client.pidk, {
                  enabled: false,
                  superseded: new Date().toISOString(),
                  hardlock: client.opt.includes('hardlock'),
                  sqrlonly: client.opt.includes('sqrlonly')
                });
                // Flag this is new idk
                clientReturn.tif |= 0x01;
                // Log in an account
                await nutCrud.update(
                  existingNut.code,
                  previousSqrl.user_id,
                  new Date().toISOString()
                );
                logger.info(
                  { client, clientReturn, previousSqrl },
                  'Logging in user'
                );
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
            if (!existingNut.user_id) {
              await nutCrud.update(existingNut.nut, userId);
              existingNut.user_id = user_id;
            }
            await nutCrud.update(
              existingNut.code,
              userId,
              new Date().toISOString()
            );
          } else {
            logger.info({ client }, 'Could not create account');
            clientReturn.tif |= 0x40;
          }
        }
        break;
      case 'enable':
        if (!sqrlData || sqrlData.enabled) {
          clientReturn.tif |= 0x40 | 0x80;
          logger.debug(
            { client, clientReturn, sqrlData },
            'Cannot enable account'
          );
        } else if (isValidUnlock(request, sqrlData)) {
          await loginUser(sqrlData, client, existingNut);
          // clear disabled bit
          clientReturn.tif &= ~0x08;
        } else {
          // Command failed
          clientReturn.tif |= 0x40;
          clientReturn.suk = sqrlData.suk;
          logger.info({ client, clientReturn }, 'Enable signature failed');
        }
        break;
      case 'disable':
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
          await nutCrud.update(
            existingNut.code,
            sqrlData.user_id,
            new Date().toISOString()
          );
          logger.info({ client, clientReturn, sqrlData }, 'Logging in user');
        } else {
          logger.debug('Cannot disable account');
          // Command failed
          // Client should not have sent command without verifying the user first
          clientReturn.tif |= 0x40 | 0x80;
        }
        break;
      case 'remove':
        if (sqrlData && sqrlData.enabled) {
          logger.info({ client, clientReturn, sqrlData }, 'Deleting sqrl');
          // Delete login to user association
          await sqrlCrud.delete(client.idk);
          // Log in an account
          await nutCrud.update(
            existingNut.code,
            sqrlData.user_id,
            new Date().toISOString()
          );
          logger.info({ client, clientReturn, sqrlData }, 'Logging in user');
        } else {
          logger.debug('Cannot remove account');
          // Command failed
          // Client should not have sent command without verifying the user first
          clientReturn.tif |= 0x40 | 0x80;
        }
        break;
      default: {
        logger.debug({ cmd: client.cmd }, 'Unknown command');
        // Command failed
        // Client should not have sent command without verifying the user first
        clientReturn.tif |= 0x40 | 0x80;
      }
    }

    // All commands except query get url when CPS is requested
    if (client.cmd !== 'query' && client.opt.includes('cps')) {
      logger.debug('Returning CPS return url');
      clientReturn.url = `${successUrl}?${querystring.encode({
        code: existingNut.code,
        ac: 1
      })}`;
    }

    return await createFollowUpReturn(clientReturn, existingNut);
  } catch (error) {
    logger.error(error);
    const clientReturn = { ver: 1, tif: 0x40 | 0x80 };
    return await createErrorReturn(clientReturn, requestIp);
  }
};

module.exports = { handler };
