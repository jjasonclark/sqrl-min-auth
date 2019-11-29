'use strict';

const url = require('url');
const get = require('dlv');
const querystring = require('querystring');
const base64url = require('universal-base64url');
const { createNut } = require('./nut');
const { previousMessageHmac, signHmac } = require('./hmac');
const { decodeSQRLPack, encodeSQRLPack } = require('./sqrl-pack');
const { isValidSignature } = require('./signature');
const { nullLogger } = require('./null-logger');

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

const defaultOptions = apiBaseUrl => ({
  logger: nullLogger(),
  codeGraceTimeout: 2 * 60 * 1000, // 2 minutes in ms
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

    return await opts.nutCrud.update({
      id: nut.initial,
      user_id: sqrl.user_id,
      identified: new Date().toISOString()
    });
  };

  // Log in an account
  const setCpsUrl = (initialNut, client, clientReturn) => {
    opts.logger.info({ initialNut, client, clientReturn }, 'Logging in user');
    // All commands except query get url when CPS is requested
    if (initialNut && client.opt.includes('cps')) {
      opts.logger.debug('Returning CPS return url');
      clientReturn.url = `${opts.authUrl}?${querystring.encode({
        code: initialNut.nut
      })}`;
    }
  };

  const claimNutOwner = async (userId, nut) => {
    if (userId && nut && !nut.user_id) {
      opts.logger.info({ userId, nut }, 'Claiming nut');
      nut.user_id = userId;
      await opts.nutCrud.update(nut);
    }
  };

  const useCode = async (code, ip) => {
    const usedCode = await opts.nutCrud.issueNut(code, ip);
    if (usedCode) {
      return usedCode;
    }
    // Allow a grace period
    if (opts.codeGraceTimeout && opts.codeGraceTimeout > 0) {
      const issuedCode = opts.nutCrud.retrieve(code);
      if (
        // found initial nut
        issuedCode &&
        // issued nut
        issuedCode.issued &&
        // within grace period
        Date.now() - issuedCode.issued <= opts.codeGraceTimeout &&
        // ip address match
        ip === issuedCode.ip
      ) {
        return issuedCode;
      }
    }
    return null;
  };

  const createAccount = async (userId, client, nut) => {
    const sqrlData = await opts.sqrlCrud.create({
      idk: client.idk,
      suk: client.suk,
      vuk: client.vuk,
      user_id: userId,
      hardlock: client.opt.includes('hardlock'),
      sqrlonly: client.opt.includes('sqrlonly'),
      created: new Date().toISOString()
    });
    if (sqrlData) {
      opts.logger.info({ sqrlData }, 'Account created');
      await claimNutOwner(userId, nut);
      return sqrlData;
    }
    opts.logger.info({ it }, 'Could not create sqrl row');
    return null;
  };

  const findAccounts = async (idks, nut) => {
    const filtered = idks.filter(Boolean);
    opts.logger.info({ idks, nut, filtered }, 'Fetching sqrl data');
    const sqrlData = await opts.sqrlCrud.retrieve(filtered);
    if (sqrlData) {
      opts.logger.debug({ sqrlData }, 'Sqrl data lookup');
      const userId = sqrlData.map(i => i.user_id).find(i => i);
      await claimNutOwner(userId, nut);
      return sqrlData;
    }
    return [];
  };

  const enableAccount = async (sqrlData, client) => {
    opts.logger.info({ sqrlData, client }, 'Enabling sqrl');
    sqrlData.disabled = null;
    sqrlData.hardlock = client.opt.includes('hardlock');
    sqrlData.sqrlonly = client.opt.includes('sqrlonly');
    // Set flags to current choices
    await opts.sqrlCrud.update(sqrlData);
  };

  const disableAccount = async (sqrlData, client) => {
    opts.logger.info({ sqrlData, client }, 'Disabling sqrl');
    sqrlData.disabled = new Date().toISOString();
    sqrlData.hardlock = client.opt.includes('hardlock');
    sqrlData.sqrlonly = client.opt.includes('sqrlonly');
    await opts.sqrlCrud.update(sqrlData);
  };

  const supersedAccount = async (sqrlData, client) => {
    opts.logger.info({ sqrlData, client }, 'Superseding sqrl');
    const updateTime = new Date().toISOString();
    sqrlData.disabled = sqrlData.disabled || updateTime;
    sqrlData.superseded = updateTime;
    // mark old idk as disabled and superseded
    await opts.sqrlCrud.update(sqrlData);
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
    const created = await opts.nutCrud.create({
      nut,
      ip: existingNut.ip,
      initial: existingNut.initial || existingNut.id,
      user_id: existingNut.user_id,
      hmac: signHmac(body)
    });
    opts.logger.info({ clientReturn, created }, 'Follow up return value');
    return body;
  };

  const createErrorReturn = async (clientReturn, ip) => {
    // TODO: don't mutate clientReturn
    const nut = await createNut();
    const created = await opts.nutCrud.create({
      nut,
      ip,
      initial: null,
      user_id: null,
      hmac: null
    });
    clientReturn.nut = nut;
    clientReturn.qry = `${opts.sqrlUrl}?${querystring.encode({
      nut
    })}`;
    const body = convertToBody(clientReturn);
    opts.logger.info({ clientReturn, created }, 'Error return value');
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
        (existingNut.initial &&
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

      // look up user
      const [sqrlData, previousSqrlData] = await findAccounts(
        [client.idk, client.pidk],
        existingNut
      );
      opts.logger.info({ sqrlData, previousSqrlData }, 'SQRL data');

      if (
        // Check IP if same ip check is requested
        (!sameIp && client.opt.includes('noiptest')) ||
        // Initial nuts are only allowed to query
        (client.cmd !== 'query' && !existingNut.initial) ||
        // Follow up nut with existing accounts have same user ids
        (existingNut.initial &&
          sqrlData &&
          sqrlData.user_id !== existingNut.user_id) ||
        // idk and pidk must have same user
        (sqrlData &&
          previousSqrlData &&
          sqrlData.user_id !== previousSqrlData.user_id)
      ) {
        opts.logger.debug({ client, existingNut }, 'Transient nut failure');
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
        if (sqrlData.disabled) {
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
          if (sqrlData && sqrlData.disabled) {
            // Add the suk value so user can enable account
            clientReturn.suk = sqrlData.suk;
            opts.logger.info({ client, clientReturn }, 'Found disabled idk');
          }
          if (previousSqrlData) {
            clientReturn.tif |= 0x02;
            if (!sqrlData) {
              clientReturn.suk = previousSqrlData.suk;
            }
          }
          break;
        case 'ident':
          if (sqrlData) {
            if (!sqrlData.disabled) {
              await enableAccount(sqrlData, client);
              // Log in an account
              const initialNut = await sqrlLogin(sqrlData, existingNut);
              setCpsUrl(initialNut, client, clientReturn);
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
          } else if (previousSqrlData) {
            if (previousSqrlData.superseded) {
              clientReturn.tif |= 0x200 | 0x40;
              opts.logger.debug(
                { client, clientReturn, previousSqrlData },
                'Previous idk has been superseded'
              );
            } else if (!isValidUnlock(request, previousSqrlData)) {
              clientReturn.tif |= 0x40;
              opts.logger.debug(
                { client, clientReturn, previousSqrlData },
                'Previous idk unlock signature failed'
              );
            } else {
              opts.logger.info(
                { client, previousSqrlData },
                'Creating new idk from previous account'
              );
              const success = await createAccount(
                previousSqrlData.user_id,
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
                await supersedAccount(previousSqrlData, client);
                // Flag this is new idk
                clientReturn.tif |= 0x01;
                // Log in an account
                setCpsUrl(
                  await sqrlLogin(previousSqrlData, existingNut),
                  client,
                  clientReturn
                );
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
                setCpsUrl(
                  await sqrlLogin({ user_id: user.id }, existingNut),
                  client,
                  clientReturn
                );
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
            const initialNut = await sqrlLogin(sqrlData, existingNut);
            setCpsUrl(initialNut, client, clientReturn);
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
          setCpsUrl(
            await sqrlLogin(sqrlData, existingNut),
            client,
            clientReturn
          );
          break;
        case 'remove':
          await removeAccount(sqrlData);
          // Log in an account
          setCpsUrl(
            await sqrlLogin(sqrlData, existingNut),
            client,
            clientReturn
          );
          break;
        default: {
          opts.logger.debug({ cmd: client.cmd }, 'Unknown command');
          // Command failed
          // Client should not have sent command without verifying the user first
          clientReturn.tif |= 0x40 | 0x80;
        }
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
    const savedNut = await opts.nutCrud.create({
      ip,
      nut,
      initial: null,
      user_id: null,
      hmac: null
    });
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

  return { handler, useCode, createUrls };
};

module.exports = { createSQRLHandler };
