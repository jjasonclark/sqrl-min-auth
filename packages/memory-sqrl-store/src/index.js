'use strict';

class MemorySqrlStore {
  constructor(options) {
    this.logger = options.logger;
    this.nuts = {};
    this.sqrl = {};
    this.users = {};
  }

  async createNut(it) {
    // TODO: verify write
    const newNut = {
      id: Object.keys(this.nuts).length,
      initial: it.initial,
      hmac: it.hmac,
      ip: it.ip,
      user_id: it.user_id,
      created: new Date().toISOString(),
      used: null,
      issued: null,
      identified: null
    };
    this.nuts[newNut.id] = newNut;
    return newNut;
  }

  async retrieveNut(id) {
    return this.nuts[id];
  }

  async updateNut(it) {
    if (this.nuts[it.id]) {
      this.nuts[it.id] = it;
      return it;
    }
    return null;
  }

  async createSqrl(it) {
    const sqrl = {
      idk: it.idk,
      suk: it.suk,
      vuk: it.vuk,
      user_id: it.user_id,
      created: new Date().toISOString(),
      disabled: null,
      superseded: null
    };
    this.sqrl[sqrl.idk] = sqrl;
    return sqrl;
  }

  async retrieveSqrl(idks) {
    return idks.reduce((memo, idk) => [...memo, this.sqrl[idk] || null], []);
  }

  async updateSqrl(it) {
    if (this.sqrl[it.idk]) {
      this.sqrl[it.idk] = it;
      return it;
    }
    return null;
  }

  async deleteSqrl(it) {
    this.sqrl
      .filter(sqrl => sqrl.user_id === it.user_id)
      .forEach(sqrl => {
        delete this.sqrl[sqrl.idk];
      });
  }

  async createUser() {
    // Create an account
    const user = {
      id: Object.keys(this.users).length,
      created: new Date().toISOString()
    };
    this.users[user.id] = user;
    return user;
  }

  async deleteUser(id) {
    // Delete user
    if (this.users[id]) {
      const user = this.users[id];
      delete this.users[id];
      return user;
    }
    return null;
  }
}

module.exports = MemorySqrlStore;
