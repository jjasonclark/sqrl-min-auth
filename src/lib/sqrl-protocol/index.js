'use strict';

const url = require('url');
const get = require('dlv');
const querystring = require('querystring');
const base64url = require('universal-base64url');
const { createNut } = require('./nut');
const { previousMessageHmac, signHmac } = require('./hmac');
const { decodeSQRLPack, encodeSQRLPack } = require('./sqrl-pack');
const { isValidSignature } = require('./signature');

const verifySignature = (request, { idk }) =>
  isValidSignature(request, request.ids, idk);

const verifyPreviousSignature = (request, { pidk }) =>
  isValidSignature(request, request.pids, pidk);

const isValidUnlock = (request, { vuk }) =>
  isValidSignature(request, request.urs, vuk);

const convertToBody = clientReturn => {
  clientReturn.tif = clientReturn.tif.toString(16);
  const rawReturn = encodeSQRLPack(clientReturn);
  return base64url.encode(rawReturn);
};

const nullLogger = () => ({
  info() {},
  warn() {},
  error() {},
  debug() {}
});

const defaultOptions = apiBaseUrl => ({
  logger: nullLogger(),
  nutTimeout: 60 * 60 * 1000, // 1 hour in ms
  // used for qry return value
  sqrlUrl: '/sqrl',
  // used for login url
  sqrlProtoUrl: `sqrl://${apiBaseUrl.hostname}/sqrl`,
  successUrl: `${apiBaseUrl}/loggedin`,
  authUrl: `${apiBaseUrl}/authenticate`,
  x: apiBaseUrl.pathname.length,
  cpsBaseUrl: 'http://localhost:25519'
});

const applyDefaults = (dest, defaults) => {
  Object.keys(defaults).forEach(key => {
    if (!dest.hasOwnProperty(key)) {
      dest[key] = defaults[key];
    }
  });
  return dest;
};

const createSQRLHandler = options => {
  const apiBaseUrl = new url.URL(options.baseUrl);
  const path = `${apiBaseUrl.pathname}/sqrl`;
  const opts = applyDefaults(
    {
      logger: options.logger,
      nutTimeout: 60 * 60 * 1000, // 1 hour in ms
      // used for qry return value
      sqrlUrl: path,
      // used for login url
      sqrlProtoUrl: `sqrl://${apiBaseUrl.hostname}${path}`,
      successUrl: `${options.baseUrl}/loggedin`,
      authUrl: `${options.baseUrl}/authenticate`,
      x: apiBaseUrl.pathname.length,
      sqrlCrud: options.sqrlCrud,
      nutCrud: options.nutCrud,
      userCrud: options.userCrud
    },
    defaultOptions(apiBaseUrl)
  );
  // TODO: validate required options are set

  // Log in an account
  const sqrlLogin = async (sqrl, nut) => {
    opts.logger.info({ nut, sqrl }, 'Logging in user');
    await opts.nutCrud.update(nut.code, sqrl.user_id, new Date().toISOString());
  };

  const claimNutOwner = async (userId, existingNut) => {
    if (!existingNut.user_id) {
      await opts.nutCrud.update(existingNut.nut, userId);
      existingNut.user_id = userId;
    }
  };

  const createAccount = async (userId, client, nut) => {
    const sqrlData = await opts.sqrlCrud.create({
      idk: client.idk,
      suk: client.suk,
      vuk: client.vuk,
      user_id: userId,
      hardlock: client.opt.includes('hardlock'),
      sqrlonly: client.opt.includes('sqrlonly')
    });
    if (sqrlData) {
      await claimNutOwner(userId, nut);
      return sqrlData;
    }
    return null;
  };

  const findAccount = async (idk, nut) => {
    const sqrlData = await opts.sqrlCrud.retrieve(idk);
    opts.logger.debug({ sqrlData }, 'Sqrl data lookup');
    if (sqrlData) {
      await claimNutOwner(sqrlData.user_id, nut);
    }
    return sqrlData;
  };

  const enableAccount = async (sqrlData, client) => {
    // Set flags to current choices
    await opts.sqrlCrud.update(sqrlData.idk, {
      // enable login
      enabled: true,
      hardlock: client.opt.includes('hardlock'),
      sqrlonly: client.opt.includes('sqrlonly')
    });
  };

  const disableAccount = async (sqrlData, client) => {
    opts.logger.info({ sqrlData }, 'Disabling sqrl');
    await opts.sqrlCrud.update(sqrlData.idk, {
      enabled: false,
      hardlock: client.opt.includes('hardlock'),
      sqrlonly: client.opt.includes('sqrlonly')
    });
  };

  const supersedAccount = async client => {
    opts.logger.info({ client }, 'Superseding sqrl pidk');
    // mark old idk as disabled and superseded
    await opts.sqrlCrud.update(client.pidk, {
      enabled: false,
      superseded: new Date().toISOString(),
      hardlock: client.opt.includes('hardlock'),
      sqrlonly: client.opt.includes('sqrlonly')
    });
  };

  const removeAccount = async sqrlData => {
    opts.logger.info({ sqrlData }, 'Deleting sqrl');
    // Delete login to user association
    await opts.sqrlCrud.delete(sqrlData.user_id);
    // Delete user account
    await opts.userCrud.delete(sqrlData.user_id);
  };

  const createFollowUpReturn = async (clientReturn, existingNut) => {
    // TODO: don't mutate clientReturn
    const nut = await createNut();
    clientReturn.nut = nut;
    clientReturn.qry = `${opts.sqrlUrl}?${querystring.encode({
      nut
    })}`;
    const body = convertToBody(clientReturn);
    await opts.nutCrud.create({ ...existingNut, nut, hmac: signHmac(body) });
    opts.logger.info({ clientReturn }, 'Follow up return value');
    return body;
  };

  const createErrorReturn = async (clientReturn, ip) => {
    // TODO: don't mutate clientReturn
    const nut = await createNut();
    await opts.nutCrud.create({ nut, code: nut, ip });
    clientReturn.nut = nut;
    clientReturn.qry = `${opts.sqrlUrl}?${querystring.encode({
      nut
    })}`;
    const body = convertToBody(clientReturn);
    opts.logger.info({ clientReturn }, 'Error return value');
    return body;
  };

  const handler = async (requestIp, inputNut, body) => {
    try {
      const request = querystring.decode(body);
      const client = decodeSQRLPack(
        base64url.decode(get(request, 'client', ''))
      );
      // TODO: Validate size of incoming body, request, and client
      // TODO: verify client param has required values such as idk
      opts.logger.debug({ request, client }, 'Decoded request');

      const existingNut = await opts.nutCrud.useNut(inputNut);
      if (
        // must have nut
        !existingNut ||
        // Follow up nut's have same hmac
        (existingNut.nut !== existingNut.code &&
          previousMessageHmac(request) !== existingNut.hmac) ||
        // nut created within timeout
        Date.now() - existingNut.created > opts.nutTimeout
      ) {
        opts.logger.debug({ client, existingNut }, 'Nut invalid');
        return await createErrorReturn({ ver: 1, tif: 0x20 }, requestIp);
      }
      opts.logger.debug({ client, existingNut }, 'Nut verified');

      if (
        // valid signature
        !verifySignature(request, client) ||
        // valid previous signature
        (client.pidk && !verifyPreviousSignature(request, client))
      ) {
        opts.logger.debug({ client, existingNut }, 'Signature or nut invalid');
        return await createErrorReturn({ ver: 1, tif: 0x40 | 0x80 }, requestIp);
      }
      opts.logger.debug({ client, existingNut }, 'Signatures verified');

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
        opts.logger.debug(
          { client, existingNut },
          'Invalid nut via client actions'
        );
        return await createErrorReturn({ ver: 1, tif: 0x20 | 0x80 }, requestIp);
      }

      // look up user
      const sqrlData = await findAccount(client.idk, existingNut);

      // Follow up nut with existing accounts have same user ids
      if (
        existingNut.nut !== existingNut.code &&
        sqrlData &&
        sqrlData.user_id !== existingNut.user_id
      ) {
        opts.logger.debug(
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
        opts.logger.info(
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

      const isBasicCommand = ['query', 'ident'].includes(client.cmd);
      if (
        // Unknown idks can only query and ident
        (!sqrlData && !isBasicCommand) ||
        // Superseded idks can only use the query command
        (client.cmd !== 'query' && sqrlData && sqrlData.superseded) ||
        // Pidks can only query and ident
        (client.pidk && !isBasicCommand)
      ) {
        opts.logger.debug(
          { client, clientReturn, existingNut },
          'Cannot processes'
        );
        clientReturn.tif |= 0x40 | 0x80;
        return await createErrorReturn(clientReturn, requestIp);
      }

      // Process SQRL command
      opts.logger.info(
        { client, clientReturn, sqrlData },
        'Processing command'
      );
      switch (client.cmd) {
        case 'query':
          if (sqrlData && !sqrlData.enabled) {
            // Add the suk value so user can enable account
            clientReturn.suk = sqrlData.suk;
            opts.logger.info({ client, clientReturn }, 'Found disabled idk');
          }
          if (client.pidk) {
            const previousSqrl = await findAccount(client.pidk, existingNut);
            if (previousSqrl) {
              opts.logger.info(
                { client, clientReturn, previousSqrl },
                'Found pidk'
              );
              clientReturn.tif |= 0x02;
              clientReturn.suk = sqrlData.suk;
            }
          }
          break;
        case 'ident':
          if (sqrlData) {
            if (sqrlData.enabled) {
              await enableAccount(sqrlData, client);
              // Log in an account
              await sqrlLogin(sqrlData, existingNut);
            } else {
              // Command failed
              clientReturn.tif |= 0x40;
              // Add the suk value so user can unlock
              clientReturn.suk = sqrlData.suk;
              opts.logger.info(
                { client, clientReturn, sqrlData },
                'Ident failed on disabled account'
              );
            }
          } else if (client.pidk) {
            opts.logger.debug(
              'Previous signature verified; Attempting superseded'
            );
            const previousSqrl = await findAccount(client.pidk, existingNut);
            if (!previousSqrl) {
              clientReturn.tif |= 0x40;
            } else {
              if (previousSqrl.superseded) {
                clientReturn.tif |= 0x200 | 0x40;
                opts.logger.debug(
                  { client, clientReturn, previousSqrl },
                  'Previous idk has been superseded'
                );
              } else if (!isValidUnlock(request, previousSqrl)) {
                clientReturn.tif |= 0x40;
                opts.logger.debug(
                  { client, clientReturn, previousSqrl },
                  'Previous idk unlock signature failed'
                );
              } else {
                opts.logger.info(
                  { client, previousSqrl },
                  'Creating new idk from previous account'
                );
                const success = await createAccount(
                  previousSqrl.user_id,
                  client,
                  existingNut
                );
                if (!success) {
                  opts.logger.debug(
                    { client, request },
                    'Could not create new idk'
                  );
                  clientReturn.tif |= 0x40;
                } else {
                  // mark old idk as disabled and superseded
                  await supersedAccount(client);
                  // Flag this is new idk
                  clientReturn.tif |= 0x01;
                  // Log in an account
                  await sqrlLogin(previousSqrl, existingNut);
                }
              }
            }
          } else {
            opts.logger.info('Unknown user. Creating account');
            const user = await opts.userCrud.create();
            if (user) {
              const success = await createAccount(user.id, client, existingNut);
              if (success) {
                clientReturn.tif |= 0x01;
                // Log in account
                await sqrlLogin({ user_id: user.id }, existingNut);
              } else {
                opts.logger.info({ client }, 'Could not create account');
                clientReturn.tif |= 0x40;
              }
            } else {
              opts.logger.info({ client }, 'Could not create account');
              clientReturn.tif |= 0x40;
            }
          }
          break;
        case 'enable':
          if (isValidUnlock(request, sqrlData)) {
            await enableAccount(sqrlData, client);
            // Log in an account
            await sqrlLogin(sqrlData, existingNut);
            // clear disabled bit
            clientReturn.tif &= ~0x08;
          } else {
            // Command failed
            clientReturn.tif |= 0x40;
            clientReturn.suk = sqrlData.suk;
            opts.logger.info(
              { client, clientReturn },
              'Enable signature failed'
            );
          }
          break;
        case 'disable':
          // Set flags to current choices
          await disableAccount(sqrlData, client);
          // Log in an account
          await sqrlLogin(sqrlData, existingNut);
          break;
        case 'remove':
          await removeAccount(sqrlData);
          // Log in an account
          await sqrlLogin(sqrlData, existingNut);
          break;
        default: {
          opts.logger.debug({ cmd: client.cmd }, 'Unknown command');
          // Command failed
          // Client should not have sent command without verifying the user first
          clientReturn.tif |= 0x40 | 0x80;
        }
      }

      // All commands except query get url when CPS is requested
      if (client.cmd !== 'query' && client.opt.includes('cps')) {
        opts.logger.debug('Returning CPS return url');
        clientReturn.url = `${opts.authUrl}?${querystring.encode({
          code: existingNut.code,
          ac: 1
        })}`;
      }

      return await createFollowUpReturn(clientReturn, existingNut);
    } catch (error) {
      opts.logger.error(error);
      const clientReturn = { ver: 1, tif: 0x40 | 0x80 };
      return await createErrorReturn(clientReturn, requestIp);
    }
  };

  const createUrls = async ip => {
    opts.logger.debug({ ip }, 'Create urls');
    const nut = await createNut();
    opts.logger.debug({ nut }, 'Created nut');
    const savedNut = await opts.nutCrud.create({ ip, nut, code: nut });
    opts.logger.debug({ nut, savedNut }, 'Saved nut');
    const urlReturn = { nut };
    if (opts.x > 0) {
      urlReturn.x = opts.x;
    }
    const cpsAuthUrl = `${opts.sqrlProtoUrl}?${querystring.encode({
      ...urlReturn,
      can: base64url.encode(path)
    })}`;
    return {
      cps: `${opts.cpsBaseUrl}/${base64url.encode(cpsAuthUrl)}`,
      login: `${opts.sqrlProtoUrl}?${querystring.encode(urlReturn)}`,
      poll: `${opts.authUrl}?${querystring.encode({ code: urlReturn.nut })}`,
      success: opts.successUrl
    };
  };

  return { handler, useCode: opts.nutCrud.useCode, createUrls };
};

module.exports = { createSQRLHandler };
