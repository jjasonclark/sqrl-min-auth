'use strict';

const base64url = require('universal-base64url');
const get = require('dlv');
const querystring = require('querystring');
const url = require('url');
const NonceFormatter = require('./nonce-formatter');
const IdentityProvider = require('./identity-provider');
const { decodeSQRLPack, encodeSQRLPack } = require('./sqrl-pack');
const { isValidSignature } = require('./signature');
const { nullLogger } = require('./null-logger');
const { signHmac } = require('./hmac');

const idkLength = 43;
const maxCmdLength = 7;
const maxIpLength = 23;
const maxMessageSize = 4096;
const maxNutParamLength = 12;
const protocolVersion = '1';

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
  const nonceFormatter = new NonceFormatter(opts.blowfishSecrets);
  const identityProvider = new IdentityProvider(opts);

  // TODO: validate required options are set

  const signData = what => signHmac(what.toString(), opts.hmacSecret);

  const createUser = async () => {
    opts.logger.info('Creating user');
    return await opts.store.createUser();
  };

  const retrieveUser = async userId => await opts.store.retrieveUser(userId);

  const deleteUser = async userId => await opts.store.deleteUser(userId);

  const createNut = async what => await opts.store.createNut(what);

  const retrieveNut = async nutId => await opts.store.retrieveNut(nutId);

  const updateNut = async nut => await opts.store.updateNut(nut);

  const findFromNutParam = nutParam => {
    opts.logger.debug({ nutParam }, 'Nut lookup');
    const nutId = nonceFormatter.parseNutParam(nutParam);
    if (nutId) {
      return retrieveNut(nutId);
    }
    return null;
  };

  const createUrls = async (ip, userId = null) => {
    opts.logger.debug({ ip }, 'Create urls');
    const savedNut = await createNut({
      ip,
      initial: null,
      user_id: userId,
      hmac: null
    });
    opts.logger.debug({ savedNut }, 'Saved nut');
    const urlReturn = { nut: nonceFormatter.formatReturnNut(savedNut) };
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
      poll: `${opts.authUrl}?${querystring.encode({
        code: nonceFormatter.formatOffCode(savedNut)
      })}`,
      success: opts.successUrl
    };
  };

  const useCode = async (codeParam, ip) => {
    const { code, type } = nonceFormatter.parseCodeParam(codeParam);
    if (!code || !type) {
      return null;
    }
    const nut = await retrieveNut(code);
    // nut must match ip and be identified and not issued
    // plus cps type must be follow up nut
    // plus off type must be initial nut
    if (
      nut &&
      ((type === 'off-' && !nut.initial) || (type === 'cps-' && nut.initial)) &&
      nut.ip === ip &&
      nut.identified &&
      nut.user_id &&
      !nut.issued
    ) {
      nut.issued = new Date().toISOString();
      await updateNut(nut);
      return retrieveUser(nut.user_id);
    }
    return null;
  };

  const createFollowUpReturn = async (clientReturn, existingNut) => {
    const created = await createNut({
      ip: existingNut.ip,
      initial: existingNut.initial || existingNut.id,
      user_id: existingNut.user_id,
      hmac: null
    });
    const nut = nonceFormatter.formatReturnNut(created);
    clientReturn.nut = nut;
    clientReturn.qry = `${opts.sqrlUrl}?${querystring.encode({ nut })}`;
    opts.logger.info({ clientReturn, created }, 'Return value');
    const body = convertToBody(clientReturn);
    created.hmac = signData(body);
    await updateNut(created);
    return body;
  };

  const createErrorReturn = async (clientReturn, ip) => {
    const created = await createNut({
      ip,
      initial: null,
      user_id: null,
      hmac: null
    });
    const nut = nonceFormatter.formatReturnNut(created);
    clientReturn.nut = nut;
    clientReturn.qry = `${opts.sqrlUrl}?${querystring.encode({ nut })}`;
    opts.logger.info({ clientReturn, created }, 'Return value');
    return convertToBody(clientReturn);
  };

  // Log in an account
  const sqrlLogin = async (sqrl, nut, client, clientReturn) => {
    opts.logger.info({ nut, sqrl, client, clientReturn }, 'Logging in user');
    let loginNut = nut;
    if (client.opt.includes('cps')) {
      // CPS log in
      loginNut = nut;
      clientReturn.url = `${opts.authUrl}?${querystring.encode({
        code: nonceFormatter.formatCpsCode(nut)
      })}`;
    } else {
      // off device login
      loginNut = await retrieveNut(nut.initial);
    }
    loginNut.identified = new Date().toISOString();
    loginNut.user_id = sqrl.user_id;
    await updateNut(loginNut);
  };

  const handler = async (ip, inputNut, body) => {
    try {
      // validate input params
      if (
        !body ||
        body.toString().length > maxMessageSize ||
        !inputNut ||
        inputNut.length > maxNutParamLength ||
        !ip ||
        ip.length > maxIpLength
      ) {
        opts.logger.debug({ inputNut, ip, body }, 'Invalid inputs');
        return await createErrorReturn({ ver: 1, tif: 0x80 }, ip);
      }

      const request = querystring.decode(body);
      const client = decodeSQRLPack(
        base64url.decode(get(request, 'client', ''))
      );

      // validate decoded params
      if (
        !client ||
        client.ver !== protocolVersion ||
        !client.idk ||
        client.idk.length !== idkLength ||
        !client.opt ||
        !client.cmd ||
        client.cmd.length > maxCmdLength ||
        !request ||
        !request.server ||
        !request.ids ||
        // server should include nut
        request.server.includes(querystring.encode({ nut: inputNut })) ||
        // valid signature
        !isValidSignature(request, request.ids, client.idk) ||
        // valid previous signature
        (client.pidk && !isValidSignature(request, request.pids, client.pidk))
      ) {
        opts.logger.debug({ request, client }, 'Invalid decoded inputs');
        return await createErrorReturn({ ver: 1, tif: 0x80 }, ip);
      }

      const nut = await findFromNutParam(inputNut);
      if (
        // must have nut
        !nut ||
        // must not be used
        nut.used ||
        // Follow up nut's have same hmac
        (nut.initial && signData(request.server) !== nut.hmac) ||
        // nut created within timeout
        Date.now() - Date.parse(nut.created) > opts.nutTimeout
      ) {
        opts.logger.debug({ nut }, 'Nut invalid');
        return await createErrorReturn({ ver: 1, tif: 0x20 }, ip);
      }
      nut.used = new Date().toISOString();
      await updateNut(nut);

      // Do same IP check for every request
      // even if not requested to
      // If success mark return as success
      // Fail is covered when the nut is marked as invalid
      const sameIp = nut.ip === ip;

      // look up user
      const [sqrlData, pSqrlData] = await identityProvider.find([
        client.idk,
        client.pidk
      ]);
      opts.logger.info({ sqrlData, pSqrlData }, 'SQRL data');

      const found = [sqrlData, pSqrlData].find(i => get(i, 'user_id'));
      if (found && nut && !nut.user_id) {
        opts.logger.info({ found, nut }, 'Claiming nut for user');
        nut.user_id = found.user_id;
        await updateNut(nut);
      }

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
            if (
              !sqrlData.disabled &&
              (await identityProvider.enable(sqrlData))
            ) {
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
              (await identityProvider.create(pSqrlData.user_id, client)) &&
              // mark old idk as disabled and superseded
              (await identityProvider.superseded(pSqrlData))
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
            opts.logger.info('Unknown idk');
            const userId = nut.user_id || get(await createUser(), 'id');
            const newSqrl = await identityProvider.create(userId, client);
            if (userId && newSqrl) {
              opts.logger.debug({ newSqrl }, 'Created new SQRL');
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
            (await identityProvider.enable(sqrlData))
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
          if (await identityProvider.disable(sqrlData)) {
            // Log in an account
            await sqrlLogin(sqrlData, nut, client, clientReturn);
          }
          return await createFollowUpReturn(clientReturn, nut);
        case 'remove':
          if (await identityProvider.remove(sqrlData)) {
            // Delete user account
            await deleteUser(sqrlData.user_id);
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

  return { handler, useCode, createUrls, createUser };
};

module.exports = { createSQRLHandler };
