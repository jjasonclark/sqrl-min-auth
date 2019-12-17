'use strict';

const base64url = require('universal-base64url');
const get = require('dlv');
const querystring = require('querystring');
const url = require('url');
const { createNut, decodeNut } = require('./nut');
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
    blowfishSecrets: {
      key: '',
      iv: ''
    },
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

  const signData = what => signHmac(what.toString(), opts.hmacSecret);

  const encode = what => `${what}.${signData(what)}`;

  const decode = what => {
    const firstDot = what.indexOf('.');
    if (firstDot < 1 || what.length < 3) {
      return null;
    }
    const group = what.substring(0, firstDot);
    const signature = what.substr(firstDot + 1);
    if (signature !== signData(group)) {
      return null;
    }
    return group;
  };

  const formatReturnNut = nut => createNut(nut.id, opts.blowfishSecrets);

  const findFromNutParam = nutParam =>
    opts.store.retrieveNut(
      decodeNut(nutParam, opts.blowfishSecrets).reduce((a, c) => (a << 8) + c)
    );

  const authUrl = code =>
    `${opts.authUrl}?${querystring.encode({
      code: encode(code)
    })}`;

  const createUser = async () => await opts.store.createUser();

  const deleteUser = async userId => await opts.store.deleteUser(userId);

  const createUrls = async ip => {
    opts.logger.debug({ ip }, 'Create urls');
    // TODO: handle nut collision
    const savedNut = await opts.store.createNut({
      ip,
      initial: null,
      user_id: null,
      hmac: null
    });
    opts.logger.debug({ savedNut }, 'Saved nut');
    const urlReturn = { nut: formatReturnNut(savedNut) };
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
      poll: authUrl(`off-${urlReturn.nut}`),
      success: opts.successUrl
    };
  };

  // Device log in
  const deviceSqrlLogin = async (nut, sqrl) => {
    opts.logger.info({ nut, sqrl }, 'Logging in user');
    const initialNut = await opts.store.retrieveNut(nut.initial);
    initialNut.identified = new Date().toISOString();
    initialNut.user_id = sqrl.user_id;
    await opts.store.updateNut(initialNut);
  };

  // CPS log in
  const cpsSqrlLogin = async (nut, clientReturn) => {
    opts.logger.info({ nut, clientReturn }, 'CPS log in');
    nut.identified = new Date().toISOString();
    clientReturn.url = authUrl(`cps-${formatReturnNut(nut)}`);
    await opts.store.updateNut(nut);
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
      await opts.store.updateNut(nut);
    }
  };

  const useCode = async (codeParam, ip) => {
    const group = decode(codeParam);
    if (!group || group.length < 5) {
      return null;
    }
    const separator = group.indexOf('-');
    if (separator !== 3) {
      return null;
    }
    const type = group.substring(0, separator);
    if (!['off', 'cps'].includes(type)) {
      return null;
    }
    const code = group.substr(separator + 1);
    const nut = await findFromNutParam(code);
    // nut must match ip and be identified and not issued
    if (!nut || nut.ip !== ip || !nut.identified || nut.issued) {
      return null;
    }
    nut.issued = new Date().toISOString();

    // TODO: verify nut is initial or cps
    return await opts.store.updateNut(nut);
  };

  const withinTimeout = nut =>
    Date.now() - Date.parse(nut.created) > opts.nutTimeout;

  const createFollowUpReturn = async (clientReturn, existingNut) => {
    const created = await opts.store.createNut({
      ip: existingNut.ip,
      initial: existingNut.initial || existingNut.id,
      user_id: existingNut.user_id,
      hmac: null
    });
    // TODO: don't mutate clientReturn
    const nut = formatReturnNut(created);
    clientReturn.nut = nut;
    clientReturn.qry = `${opts.sqrlUrl}?${querystring.encode({ nut })}`;
    opts.logger.info({ clientReturn, created }, 'Return value');
    const body = convertToBody(clientReturn);
    created.hmac = signData(body);
    await opts.store.updateNut(created);
    return body;
  };

  const createErrorReturn = async (clientReturn, ip) => {
    const created = await opts.store.createNut({
      ip,
      initial: null,
      user_id: null,
      hmac: null
    });
    const nut = formatReturnNut(created);
    // TODO: don't mutate clientReturn
    clientReturn.nut = nut;
    clientReturn.qry = `${opts.sqrlUrl}?${querystring.encode({ nut })}`;
    opts.logger.info({ clientReturn, created }, 'Return value');
    return convertToBody(clientReturn);
  };

  const boolResult = async func => {
    try {
      await func();
      return true;
    } catch (ex) {
      return false;
    }
  };

  const findAccounts = async idks => {
    const filtered = idks.filter(Boolean);
    opts.logger.info({ idks, filtered }, 'Fetching sqrl data');
    const results = await opts.store.retrieveSqrl(filtered);
    return results || [];
  };

  const createAccount = async (userId, client) => {
    if (!userId || !client) {
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
    const result = await boolResult(() => opts.store.createSqrl(sqrlData));
    return result ? sqrlData : null;
  };

  const enableAccount = async sqrlData => {
    opts.logger.info({ sqrlData }, 'Enabling sqrl');
    sqrlData.disabled = null;
    // Set flags to current choices
    return await boolResult(() => opts.store.updateSqrl(sqrlData));
  };

  const disableAccount = async sqrlData => {
    opts.logger.info({ sqrlData }, 'Disabling sqrl');
    sqrlData.disabled = new Date().toISOString();
    return await boolResult(() => opts.store.updateSqrl(sqrlData));
  };

  const supersededAccount = async sqrlData => {
    opts.logger.info({ sqrlData }, 'Superseding sqrl');
    const updateTime = new Date().toISOString();
    sqrlData.disabled = sqrlData.disabled || updateTime;
    sqrlData.superseded = updateTime;
    // mark old idk as disabled and superseded
    return await boolResult(() => opts.store.updateSqrl(sqrlData));
  };

  const removeAccount = async sqrlData => {
    opts.logger.info({ sqrlData }, 'Deleting sqrl');
    return (
      // Delete login to user association
      (await boolResult(() => opts.store.deleteSqrl(sqrlData))) &&
      // Delete user account
      (await boolResult(() => deleteUser(sqrlData.user_id)))
    );
  };

  const isValidInput = (client, inputNut, request) => {
    return !client || !inputNut || !request || !request.server || !request.ids;
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

      if (
        // must have client, inputNut, and request
        isValidInput(client, inputNut, request) ||
        // server should include nut
        request.server.includes(querystring.encode({ nut: inputNut })) ||
        // valid signature
        !isValidSignature(request, request.ids, client.idk) ||
        // valid previous signature
        (client.pidk && !isValidSignature(request, request.pids, client.pidk))
      ) {
        opts.logger.debug({ inputNut }, 'Invalid input');
        return await createErrorReturn({ ver: 1, tif: 0x80 }, ip);
      }

      const nut = await findFromNutParam(inputNut);
      opts.logger.debug({ nut }, 'Nut lookup');
      if (
        // must have nut
        !nut ||
        // must not be used
        nut.used ||
        // Follow up nut's have same hmac
        (nut.initial && signData(request.server) !== nut.hmac) ||
        // nut created within timeout
        withinTimeout(nut)
      ) {
        opts.logger.debug({ nut }, 'Nut invalid');
        return await createErrorReturn({ ver: 1, tif: 0x20 }, ip);
      }
      nut.used = new Date().toISOString();
      await opts.store.updateNut(nut);

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
        return await createFollowUpReturn(clientReturn, nut);
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
          return await createFollowUpReturn(clientReturn, nut);
        case 'ident':
          if (sqrlData) {
            if (!sqrlData.disabled && (await enableAccount(sqrlData))) {
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
            } else if (
              isValidSignature(request, request.urs, pSqrlData.vuk) &&
              (await createAccount(pSqrlData.user_id, client)) &&
              // mark old idk as disabled and superseded
              (await supersededAccount(pSqrlData))
            ) {
              // Flag this is new idk
              clientReturn.tif |= 0x01;
              // Log in an account
              await sqrlLogin(pSqrlData, nut, client, clientReturn);
            } else {
              clientReturn.tif |= 0x40;
              opts.logger.info(
                { clientReturn },
                'Previous idk unlock signature failed'
              );
            }
          } else {
            opts.logger.info('Unknown user. Creating account');
            const user = await createUser();
            const newSqrl = await createAccount(get(user, 'id'), client);
            if (user && newSqrl) {
              opts.logger.debug({ newSqrl }, 'Created new SQRL');
              await claimNutOwner([newSqrl], nut);
              clientReturn.tif |= 0x01;
              await sqrlLogin(newSqrl, nut, client, clientReturn);
            } else {
              opts.logger.info('Could not create account');
              clientReturn.tif |= 0x40;
            }
          }
          return await createFollowUpReturn(clientReturn, nut);
        case 'enable':
          if (
            isValidSignature(request, request.urs, sqrlData.vuk) &&
            (await enableAccount(sqrlData))
          ) {
            await sqrlLogin(sqrlData, nut, client, clientReturn);
            // clear disabled bit
            clientReturn.tif &= ~0x08;
          } else {
            // Command failed
            clientReturn.tif |= 0x40;
            clientReturn.suk = sqrlData.suk;
            opts.logger.info({ clientReturn }, 'Enable signature failed');
          }
          return await createFollowUpReturn(clientReturn, nut);
        case 'disable':
          if (await disableAccount(sqrlData)) {
            // Log in an account
            await sqrlLogin(sqrlData, nut, client, clientReturn);
          }
          return await createFollowUpReturn(clientReturn, nut);
        case 'remove':
          if (await removeAccount(sqrlData)) {
            // Log in an account
            await sqrlLogin(sqrlData, nut, client, clientReturn);
          }
          return await createFollowUpReturn(clientReturn, nut);
      }
      opts.logger.debug({ cmd: client.cmd }, 'Unknown command');
      // Command failed
      clientReturn.tif |= 0x40 | 0x80;
      return await createFollowUpReturn(clientReturn, nut);
    } catch (error) {
      opts.logger.error(error);
      return await createErrorReturn({ ver: 1, tif: 0x40 | 0x80 }, ip);
    }
  };

  return { handler, useCode, createUrls };
};

module.exports = { createSQRLHandler };
