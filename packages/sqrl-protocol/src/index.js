'use strict';

const base64url = require('universal-base64url');
const get = require('dlv');
const querystring = require('querystring');
const url = require('url');
const { createNut } = require('./nut');
const { decodeSQRLPack, encodeSQRLPack } = require('./sqrl-pack');
const { isValidSignature } = require('./signature');
const { nullLogger } = require('./null-logger');
const { signHmac } = require('./hmac');

const convertToBody = clientReturn => {
  clientReturn.tif = clientReturn.tif.toString(16);
  const rawReturn = encodeSQRLPack(clientReturn);
  return base64url.encode(rawReturn);
};

const urlJoin = (left, right) =>
  left.endsWith('/') ? left + right.substr(1) : left + right;

const defaultOptions = base => {
  const portCmd = [80, 443, '80', '443', ''].includes(base.port)
    ? ''
    : `:${base.port}`;
  return {
    logger: nullLogger(),
    nutTimeout: 60 * 60 * 1000, // 1 hour in ms
    cancelPath: urlJoin(base.pathname, '/sqrl'),
    // used for qry return value
    sqrlUrl: urlJoin(base.pathname, '/sqrl'),
    // used for login url
    sqrlProtoUrl: urlJoin(
      `sqrl://${base.hostname}${portCmd}${base.pathname}`,
      '/sqrl'
    ),
    successUrl: urlJoin(base.toString(), '/loggedin'),
    authUrl: urlJoin(base.toString(), '/authenticate'),
    x: base.pathname.length - (base.pathname.endsWith('/') ? 1 : 0),
    cpsBaseUrl: 'http://localhost:25519',
    hmacSecret: ''
  };
};

const applyDefaults = (dest, defaults) =>
  Object.keys(defaults).reduce((memo, key) => {
    if (!memo.hasOwnProperty(key)) {
      memo[key] = defaults[key];
    }
    return memo;
  }, dest);

const createSQRLHandler = options => {
  const apiBaseUrl = new url.URL(options.baseUrl);
  const opts = applyDefaults({ ...options }, defaultOptions(apiBaseUrl));
  // TODO: validate required options are set

  const signData = what => signHmac(what, opts.hmacSecret);

  const authUrl = code =>
    `${opts.authUrl}?${querystring.encode({
      code: `${code}.${signData(code)}`
    })}`;

  const createUser = async () => await opts.store.createUser();

  const deleteUser = async userId => await opts.store.deleteUser(userId);

  const createUrls = async ip => {
    opts.logger.debug({ ip }, 'Create urls');
    const nut = await createNut();
    opts.logger.debug({ nut }, 'Created nut');
    // TODO: handle nut collision
    const savedNut = await opts.store.createNut({
      ip,
      nut,
      initial: null,
      user_id: null,
      hmac: null
    });
    opts.logger.debug({ savedNut }, 'Saved nut');
    const urlReturn = { nut };
    if (opts.x > 0) {
      urlReturn.x = opts.x;
    }
    const cpsAuthUrl = `${opts.sqrlProtoUrl}?${querystring.encode({
      ...urlReturn,
      can: base64url.encode(opts.cancelPath)
    })}`;
    return {
      cps: urlJoin(opts.cpsBaseUrl, `/${base64url.encode(cpsAuthUrl)}`),
      login: `${opts.sqrlProtoUrl}?${querystring.encode(urlReturn)}`,
      poll: authUrl(nut),
      success: opts.successUrl
    };
  };

  // Device log in
  const deviceSqrlLogin = async (nut, sqrl) => {
    opts.logger.info({ nut, sqrl }, 'Logging in user');

    await opts.store.identifyNut({
      id: nut.initial,
      user_id: sqrl.user_id,
      identified: new Date().toISOString()
    });
  };

  // CPS log in
  const cpsSqrlLogin = async (nut, clientReturn) => {
    opts.logger.info({ nut, clientReturn }, 'CPS log in');
    nut.identified = new Date().toISOString();
    clientReturn.url = authUrl(nut.nut);
    await opts.store.identifyNut(nut);
  };

  // Log in an account
  const sqrlLogin = async (sqrl, nut, client, clientReturn) => {
    opts.logger.info({ nut, sqrl, client, clientReturn }, 'Logging in user');
    if (client.opt.includes('cps')) {
      await cpsSqrlLogin(nut, clientReturn);
    }
    await deviceSqrlLogin(nut, sqrl);
  };

  const claimNutOwner = async (sqrlDatas, nut) => {
    opts.logger.debug({ sqrlDatas }, 'Claiming nuts');
    const userId = sqrlDatas.map(i => (i ? i.user_id : null)).find(Boolean);
    if (userId && nut && !nut.user_id) {
      opts.logger.info({ userId, nut }, 'Claiming nut for user');
      nut.user_id = userId;
      await opts.store.identifyNut(nut);
    }
  };

  const useCode = async (codeParam, ip) => {
    const firstDot = codeParam.indexOf('.');
    if (firstDot < 2 || codeParam.length < 3) {
      return null;
    }
    const code = codeParam.substring(0, firstDot);
    const signature = codeParam.substr(firstDot + 1);
    if (signature === signData(code)) {
      return await opts.store.issueNut(code, ip);
    }
    return null;
  };

  const useNut = async nutParam => await opts.store.useNut(nutParam);

  const withinTimeout = nut => Date.now() - nut.created > opts.nutTimeout;

  const createFollowUpReturn = async (clientReturn, existingNut) => {
    // TODO: don't mutate clientReturn
    const nut = await createNut();
    clientReturn.nut = nut;
    clientReturn.qry = `${opts.sqrlUrl}?${querystring.encode({ nut })}`;
    const body = convertToBody(clientReturn);
    const created = await opts.store.createNut({
      nut,
      ip: existingNut.ip,
      initial: existingNut.initial || existingNut.id,
      user_id: existingNut.user_id,
      hmac: signData(body)
    });
    opts.logger.info({ clientReturn, created }, 'Follow up return value');
    return body;
  };

  const createErrorReturn = async (clientReturn, ip) => {
    // TODO: don't mutate clientReturn
    const nut = await createNut();
    const created = await opts.store.createNut({
      nut,
      ip,
      initial: null,
      user_id: null,
      hmac: null
    });
    clientReturn.nut = nut;
    clientReturn.qry = `${opts.sqrlUrl}?${querystring.encode({ nut })}`;
    const body = convertToBody(clientReturn);
    opts.logger.info({ clientReturn, created }, 'Error return value');
    return body;
  };

  const findAccounts = async idks => {
    const filtered = idks.filter(Boolean);
    opts.logger.info({ idks, filtered }, 'Fetching sqrl data');
    const results = await opts.store.retrieveSqrl(filtered);
    return results || [];
  };

  const createAccount = async (userId, client) => {
    if (!userId) {
      return null;
    }
    const sqrlData = {
      idk: client.idk,
      suk: client.suk,
      vuk: client.vuk,
      user_id: userId,
      created: new Date().toISOString(),
      disabled: null,
      superseded: null
    };
    const result = await opts.store.createSqrl(sqrlData);
    return result ? sqrlData : null;
  };

  const enableAccount = async sqrlData => {
    opts.logger.info({ sqrlData }, 'Enabling sqrl');
    sqrlData.disabled = null;
    // Set flags to current choices
    await opts.store.updateSqrl(sqrlData);
  };

  const disableAccount = async sqrlData => {
    opts.logger.info({ sqrlData }, 'Disabling sqrl');
    sqrlData.disabled = new Date().toISOString();
    await opts.store.updateSqrl(sqrlData);
  };

  const supersedAccount = async sqrlData => {
    opts.logger.info({ sqrlData }, 'Superseding sqrl');
    const updateTime = new Date().toISOString();
    sqrlData.disabled = sqrlData.disabled || updateTime;
    sqrlData.superseded = updateTime;
    // mark old idk as disabled and superseded
    await opts.store.updateSqrl(sqrlData);
  };

  const removeAccount = async sqrlData => {
    opts.logger.info({ sqrlData }, 'Deleting sqrl');
    // Delete login to user association
    await opts.store.deleteSqrl(sqrlData.user_id);
    // Delete user account
    await deleteUser(sqrlData.user_id);
  };

  const handler = async (ip, inputNut, body) => {
    try {
      const request = querystring.decode(body);
      const client = decodeSQRLPack(
        base64url.decode(get(request, 'client', ''))
      );
      // TODO: Validate size of incoming body, request, and client
      // TODO: verify client param has required values such as idk
      opts.logger.info({ request, client }, 'Decoded request');

      // must have client and inputNut
      if (!client || !inputNut) {
        opts.logger.debug({ inputNut }, 'Invalid input');
        return await createErrorReturn({ ver: 1, tif: 0x80 }, ip);
      }

      const nut = await useNut(inputNut);
      opts.logger.debug({ nut }, 'Nut lookup');
      if (
        // must have nut
        !nut ||
        // Follow up nut's have same hmac
        (nut.initial && signData(get(request, 'server')) !== nut.hmac) ||
        // nut created within timeout
        withinTimeout(nut)
      ) {
        opts.logger.debug({ nut }, 'Nut invalid');
        return await createErrorReturn({ ver: 1, tif: 0x20 }, ip);
      }

      if (
        // valid signature
        !isValidSignature(request, request.ids, client.idk) ||
        // valid previous signature
        (client.pidk && !isValidSignature(request, request.pids, client.pidk))
      ) {
        opts.logger.debug({ nut }, 'Signature invalid');
        return await createErrorReturn({ ver: 1, tif: 0x40 | 0x80 }, ip);
      }

      // Do same IP check for every request
      // even if not requested to
      // If success mark return as success
      // Fail is covered when the nut is marked as invalid
      const sameIp = nut.ip === ip;

      // look up user
      const findResult = await findAccounts([client.idk, client.pidk]);
      await claimNutOwner(findResult, nut);
      const [sqrlData, pSqrlData] = findResult;
      opts.logger.info({ sqrlData, pSqrlData }, 'SQRL data');

      const clientReturn = { ver: 1, tif: 0 };
      if (sameIp) {
        clientReturn.tif |= 0x04;
      }

      // Found current idk
      if (sqrlData) {
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
        // Check IP if same ip check is requested
        (!sameIp && client.opt.includes('noiptest')) ||
        // Initial nuts are only allowed to query
        (client.cmd !== 'query' && !nut.initial) ||
        // Follow up nut with existing accounts have same user ids
        (nut.initial && sqrlData && sqrlData.user_id !== nut.user_id) ||
        // idk and pidk must have same user
        (sqrlData && pSqrlData && sqrlData.user_id !== pSqrlData.user_id) ||
        // Unknown idks can only query and ident
        (!sqrlData && !isBasicCommand) ||
        // Superseded idks can only use the query command
        (client.cmd !== 'query' && sqrlData && sqrlData.superseded) ||
        // Pidks can only query and ident
        (client.pidk && !isBasicCommand)
      ) {
        opts.logger.debug({ nut }, 'Cannot processes');
        clientReturn.tif |= 0x40 | 0x80;
        return await createErrorReturn(clientReturn, ip);
      }

      // Process SQRL command
      opts.logger.info({ clientReturn }, 'Processing command');
      switch (client.cmd) {
        case 'query':
          if (sqrlData && sqrlData.disabled) {
            // Add the suk value so user can enable account
            clientReturn.suk = sqrlData.suk;
          }
          if (pSqrlData) {
            clientReturn.tif |= 0x02;
            if (!sqrlData) {
              clientReturn.suk = pSqrlData.suk;
            }
          }
          break;
        case 'ident':
          if (sqrlData) {
            if (!sqrlData.disabled) {
              await enableAccount(sqrlData);
              // Log in an account
              await sqrlLogin(sqrlData, nut, client, clientReturn);
            } else {
              // Command failed
              clientReturn.tif |= 0x40;
              // Add the suk value so user can unlock
              clientReturn.suk = sqrlData.suk;
              opts.logger.info(
                { clientReturn },
                'Ident failed on disabled account'
              );
            }
          } else if (pSqrlData) {
            if (pSqrlData.superseded) {
              clientReturn.tif |= 0x200 | 0x40;
              opts.logger.debug(
                { clientReturn },
                'Previous idk has been superseded'
              );
            } else if (!isValidSignature(request, request.urs, pSqrlData.vuk)) {
              clientReturn.tif |= 0x40;
              opts.logger.info(
                { clientReturn },
                'Previous idk unlock signature failed'
              );
            } else {
              opts.logger.info('Creating new idk from previous account');
              const success = await createAccount(pSqrlData.user_id, client);
              if (!success) {
                opts.logger.info('Could not create new idk');
                clientReturn.tif |= 0x40;
              } else {
                // mark old idk as disabled and superseded
                await supersedAccount(pSqrlData);
                // Flag this is new idk
                clientReturn.tif |= 0x01;
                // Log in an account
                await sqrlLogin(pSqrlData, nut, client, clientReturn);
              }
            }
          } else {
            opts.logger.info('Unknown user. Creating account');
            const user = await createUser();
            const newSqrl = await createAccount(get(user, 'id'), client);
            if (user && newSqrl) {
              opts.logger.debug({ newSqrl }, 'Created new SQRL');
              await claimNutOwner([newSqrl], nut);
              clientReturn.tif |= 0x01;
              // Log in account
              await sqrlLogin(newSqrl, nut, client, clientReturn);
            } else {
              opts.logger.info('Could not create account');
              clientReturn.tif |= 0x40;
            }
          }
          break;
        case 'enable':
          if (isValidSignature(request, request.urs, sqrlData.vuk)) {
            await enableAccount(sqrlData);
            // Log in an account
            await sqrlLogin(sqrlData, nut, client, clientReturn);
            // clear disabled bit
            clientReturn.tif &= ~0x08;
          } else {
            // Command failed
            clientReturn.tif |= 0x40;
            clientReturn.suk = sqrlData.suk;
            opts.logger.info({ clientReturn }, 'Enable signature failed');
          }
          break;
        case 'disable':
          // Set flags to current choices
          await disableAccount(sqrlData);
          // Log in an account
          await sqrlLogin(sqrlData, nut, client, clientReturn);
          break;
        case 'remove':
          await removeAccount(sqrlData);
          // Log in an account
          await sqrlLogin(sqrlData, nut, client, clientReturn);
          break;
        default: {
          opts.logger.debug({ cmd: client.cmd }, 'Unknown command');
          // Command failed
          // Client should not have sent command without verifying the user first
          clientReturn.tif |= 0x40 | 0x80;
        }
      }

      return await createFollowUpReturn(clientReturn, nut);
    } catch (error) {
      opts.logger.error(error);
      return await createErrorReturn({ ver: 1, tif: 0x40 | 0x80 }, ip);
    }
  };

  return { handler, useCode, createUrls };
};

module.exports = { createSQRLHandler };
