'use strict';

const url = require('url');
const logger = require('pino')({ level: 'debug' });
const get = require('dlv');
const querystring = require('querystring');
const base64url = require('universal-base64url');
const { createNut } = require('../lib/nut');
const { db } = require('../lib/db');
const { sign } = require('tweetnacl');
const { createHmac } = require('crypto');
const secrets = require('../../secrets.json');

const apiBaseUrl = new url.URL(process.env.URL_BASE);

const signHmac = message => {
  const crypt = createHmac('sha256', get(secrets, 'nuts.hmac'));
  crypt.update(message);
  return crypt.digest('base64');
};

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
  logger.info({ returnValue, clientReturn }, 'Final return value');
  return returnValue;
};

// Crud for sqrl table
const sqrlCrud = {
  async create(it) {
    // failed to find the user. Need to create an account
    logger.info('Creating new user account');
    const user = await db.one('INSERT INTO users default VALUES RETURNING id');
    if (!user) {
      // something went wrong
      return null;
    }
    const sqrlIdk = await db.one(
      'INSERT INTO sqrl (idk,user_id,suk,vuk,hardlock,sqrlonly) VALUES ($1,$2,$3,$4,$5,$6) RETURNING idk',
      [it.idk, user.id, it.suk, it.vuk, it.hardlock, it.sqrlonly]
    );
    if (sqrlIdk) {
      // Account setup successfully
      logger.info('Account created');
      return user.id;
    } else {
      // something went wrong
      logger.info(
        { user },
        'Could not create sqrl row. Attempting to delete user'
      );
      // remove the created user
      await db.none('DELETE FROM users WHERE id = $1', [user.id]);
      logger.info({ user }, 'User deleted');
      return null;
    }
  },
  async retrieve(idk) {
    const result = await db.oneOrNone(
      'SELECT user_id, suk, vuk, enabled, hardlock, sqrlonly, superseded FROM sqrl WHERE idk = $1',
      [idk]
    );
    if (!result) {
      return null;
    }
    return {
      ...result,
      suk: result.suk ? result.suk.toString().trim() : null,
      vuk: result.vuk ? result.vuk.toString().trim() : null
    };
  },
  async update(idk, what) {
    // TODO: support more items to update
    return await db.none('UPDATE sqrl set enabled=$2 WHERE idk = $1', [
      idk,
      what.enabled
    ]);
  },
  async delete(idk) {
    const deletedSqrl = await db.none(
      'DELETE FROM sqrl WHERE idk = $1 returning user_id',
      [idk]
    );
    logger.info(
      { idk: client.idk, userId: deletedSqrl.user_id },
      'Deleting user'
    );
    // Delete user
    await db.none('DELETE FROM users WHERE id = $1', [deletedSqrl.user_id]);
    logger.info({ userId: deletedSqrl.user_id }, 'Deleted user');
  },
  // mark old idk as superseded
  async supersede(idk) {
    await db.none('UPDATE sqrl SET superseded=NOW() WHERE idk = $1', [
      client.pidk
    ]);
  }
};

// Crud for nuts table
const nutCrud = {
  async createInitialNut(requestIP) {
    try {
      // TODO: verify created not isn't already in DB
      const nut = await createNut();
      logger.info({ nut, requestIP }, 'Inserting new initial nut');
      // TODO: verify write
      await db.none('INSERT INTO nuts (nut,code,ip) VALUES ($1,$2,$3)', [
        nut,
        nut,
        requestIP
      ]);
      return nut;
    } catch (ex) {
      logger.info({ requestIP }, 'Create initial nut failed');
      logger.error(ex);
      return '';
    }
  },

  async createFollowUpNut(requestIP, code) {
    try {
      // TODO: verify created not isn't already in DB
      const nut = await createNut();
      await db.none('INSERT INTO nuts (nut,code,ip) VALUES ($1,$2,$3)', [
        nut,
        code,
        requestIP
      ]);
      return nut;
    } catch (ex) {
      logger.error(ex);
      return '';
    }
  },

  async markNutUsed(nut) {
    try {
      await db.none(
        'UPDATE nuts SET used=NOW() WHERE used IS NULL AND nut = $1',
        [nut]
      );
      return true;
    } catch (ex) {
      logger.error(ex);
      return false;
    }
  },

  async markUser(nut, userId) {
    try {
      await db.none(
        'UPDATE nuts SET user_id=$1 WHERE user_id IS NULL AND nut = $2',
        [userId, nut]
      );
      return true;
    } catch (ex) {
      logger.error(ex);
      return false;
    }
  },

  async markIdentified(code, userId) {
    try {
      await db.none(
        'UPDATE nuts SET identified=NOW(),user_id=$1 WHERE identified IS NULL AND nut = $2',
        [userId, code]
      );
      return true;
    } catch (ex) {
      logger.error(ex);
      return false;
    }
  },

  async updateHmac(nut, body) {
    try {
      const hmacValue = signHmac(body);
      logger.debug({ nut, hmacValue }, 'Updating follow up nut');
      await db.none('UPDATE nuts SET hmac=$1 WHERE used IS NULL AND nut = $2', [
        hmacValue,
        nut
      ]);
      return true;
    } catch (ex) {
      logger.error(ex);
      return false;
    }
  },

  async findNut(nut) {
    try {
      const result = await db.oneOrNone(
        'SELECT nut,code,ip,hmac,used,identified,issued FROM nuts WHERE nut = $1',
        [nut]
      );
      if (result) {
        const formatted = {
          nut: result.nut.toString().trim(),
          code: result.code.toString().trim(),
          ip: result.ip.toString().trim(),
          hmac: result.hmac ? result.hmac.toString().trim() : null,
          used: result.used,
          identified: result.identified,
          issued: result.issued
        };
        return formatted;
      }
    } catch (ex) {
      logger.error(ex);
      logger.info({ nut }, 'Failed to find nut');
    }
    return null;
  }
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
    const previousHmac = signHmac(get(request, 'server'));

    const existingNut = await nutCrud.findNut(inputNut);

    logger.debug(
      { request, client, previousHmac, existingNut },
      'Decoded request'
    );

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
        previousHmac === existingNut.hmac);

    if (existingNut && !existingNut.used) {
      logger.debug({ existingNut }, 'Found unused nut; marking used');
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

      // TODO: Should return url only if nut valid?
      // All commands except query get url when CPS is requested
      if (client.opt.includes('cps') && client.cmd !== 'query') {
        logger.info('Returning CPS return url');
        clientReturn.url = `${successUrl}?${querystring.encode({
          code: validNut ? get(existingNut, 'code') : get(clientReturn, 'nut')
        })}`;
      }

      // look up user
      logger.debug({ client }, 'Looking up SQRL data');
      const sqrlData = await sqrlCrud.retrieve(client.idk);
      // Found current idk
      if (sqrlData) {
        logger.info({ sqrlData }, 'Found existing sqrl data');
        sqrlData.idk = client.idk;
        if (existingNut && !existingNut.user_id) {
          await nutCrud.markUser(existingNut.nut, sqrlData.user_id);
        } else {
          // user_id matches
          validNut =
            validNut && get(sqrlData, 'user_id') === existingNut.user_id;
        }
        await nutCrud.markUser(clientReturn.nut, sqrlData.user_id);
        if (sqrlData.superseded) {
          logger.info({ previous }, 'Found a previously changed idk');
          clientReturn.tif |= 0x200;
        } else {
          clientReturn.tif |= 0x01;
          if (!sqrlData.enabled) {
            clientReturn.tif |= 0x08;
          }
          // Did the client ask for suk values?
          if (client.opt.includes('suk')) {
            clientReturn.suk = sqrlData.suk;
            clientReturn.vuk = sqrlData.vuk;
          }
        }
      } else {
        logger.info({ idk: client.idk }, 'Could not find sqrl data');
      }

      if (!validNut) {
        logger.info({ existingNut }, 'Invalid nut');
        // something wrong with input nut
        // Cannot process command
        clientReturn.tif |= 0x40 | 0x20;
        return await createReturn(clientReturn);
      }
      logger.debug(
        { client, clientReturn },
        'Nut verified; Processing command'
      );

      // Initial nuts are only allowed to query
      if (client.cmd !== 'query' && existingNut.nut === existingNut.code) {
        clientReturn.tif |= 0x20;
        logger.debug(
          { client, existingNut },
          'Initial nut used for non-query command'
        );
      } else if (client.cmd !== 'query' && clientReturn.tif & 0x200) {
        clientReturn.tif |= 0x40;
        logger.debug(
          { client, clientReturn },
          'Superseded idk used for non-query command'
        );
      } else {
        // Process SQRL command
        logger.debug({ cmd: client.cmd }, 'Processing command');
        switch (client.cmd) {
          case 'query':
            {
              if (sqrlData && !sqrlData.enabled) {
                // Add the suk value so user can enable account
                clientReturn.suk = sqrlData.suk;
                clientReturn.vuk = sqrlData.vuk;
              } else if (client.pidk) {
                if (!verifyPreviousSignature(request, client)) {
                  // Cannot process command
                  clientReturn.tif |= 0x40 | 0x80;
                } else {
                  logger.debug('Previous signature verified');
                  const previousSqrl = await sqrlCrud.retrieve(client.pidk);
                  if (previousSqrl) {
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
                      clientReturn.vuk = sqrlData.vuk;
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
                  // Log in an account
                  await nutCrud.markIdentified(
                    existingNut.code,
                    sqrlData.user_id
                  );
                  // TODO: should we update sqrlonly and hardlock?
                } else {
                  if (isValidUnlock(request, sqrlData.vuk)) {
                    // enable login
                    await sqrlCrud.update(sqrlData.idk, { enabled: true });
                    // reset disabled code
                    clientReturn.tif &= ~0x08;
                    // Log in an account
                    await nutCrud.markIdentified(
                      existingNut.code,
                      sqrlData.user_id
                    );
                  } else {
                    // Command failed
                    clientReturn.tif |= 0x40;
                    // Add the suk value so user can unlock
                    clientReturn.suk = sqrlData.suk;
                    clientReturn.vuk = sqrlData.vuk;
                  }
                }
              } else if (client.pidk) {
                if (!verifyPreviousSignature(request, client)) {
                  // Cannot process command
                  clientReturn.tif |= 0x40 | 0x80;
                } else {
                  logger.debug(
                    'Previous signature verified; Attempting superseded'
                  );
                  const previousSqrl = await sqrlCrud.retrieve(client.pidk);
                  if (!previousSqrl) {
                    clientReturn.tif |= 0x40 | 0x80;
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
                      clientReturn.tif |= 0x200 | 0x40 | 0x80;
                    } else {
                      if (!isValidUnlock(request, previousSqrl.vuk)) {
                        clientReturn.tif |= 0x40 | 0x80;
                      } else {
                        logger.info('Creating new idk from previous account');
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
              if (sqrlData) {
                if (sqrlData.enabled) {
                  logger.debug('Cannot enable an enabled account');
                  clientReturn.tif |= 0x40 | 0x80;
                } else {
                  if (isValidUnlock(request, sqrlData.vuk)) {
                    // enable login
                    await sqrlCrud.update(sqrlData.idk, { enabled: true });
                    // clear disabled bit
                    clientReturn.tif &= ~0x08;
                    // TODO: verify should login after enable
                    // Log in an account
                    await nutCrud.markIdentified(
                      existingNut.code,
                      sqrlData.user_id
                    );
                  } else {
                    // Command failed
                    clientReturn.tif |= 0x40;
                    clientReturn.suk = sqrlData.suk;
                    clientReturn.vuk = sqrlData.vuk;
                  }
                }
              } else {
                logger.debug('Cannot enable an unknown account');
                // Command failed
                // Client should not have sent command without verifying the user first
                clientReturn.tif |= 0x40 | 0x80;
              }
            }
            break;
          case 'disable':
            {
              if (sqrlData && sqrlData.enabled) {
                await sqrlCrud.update(client.idk, { enabled: false });
                logger.info(
                  { userId: sqrlData.user_id },
                  'Disabled sqrl login for user'
                );
                // Log in an account
                await nutCrud.markIdentified(
                  existingNut.code,
                  sqrlData.user_id
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
                await nutCrud.markIdentified(
                  existingNut.code,
                  sqrlData.user_id
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
