import * as EventEmitter from 'events';
import { AccessManager } from 'twilio-common';
import { SyncClient as Client } from 'twilio-sync';

let instance;
class SyncClient extends EventEmitter {
  static shared() {
    instance = instance || new SyncClient();
    return instance;
  }

  constructor() {
    super();
    this.client = undefined;
    this.accessManager = undefined;
    this.serviceSid = undefined;
    this.type = undefined;
    this.sid = undefined;
    this.instance = undefined;
  }

  async load(serviceSid, type, sid) {
    if (!this.isValidType(type)) {
      throw new Error('Invalid type!');
    }

    if (this.client === undefined) {
      return this.initialize(serviceSid, type, sid);
    }

    if (serviceSid !== this.serviceSid) {
      return this.initialize(serviceSid, type, sid);
    }

    if (sid !== this.sid) {
      return this.updateObject(serviceSid, type, sid);
    }

    return null;
  }

  async initialize(serviceSid, type, sid) {
    const token = await this.fetchToken(serviceSid);
    this.accessManager = this.createAccessManager(token);
    this.client = this.createClient(token);
    this.instance = await this.client[type](sid);
    this.sid = sid;
    this.serviceSid = serviceSid;
    this.type = type;
    this.registerEventListeners();
    const data = await this.getValue();
    console.log(data);
    return data;
  }

  async updateObject(serviceSid, type, sid) {
    this.unregisterEventListeners();
    this.instance = await this.client[type](sid);
    this.sid = sid;
    this.type = type;
    this.registerEventListeners();
    return this.getValue();
  }

  async fetchToken(serviceSid) {
    const resp = await fetch(`/api/token/?sid=${serviceSid}`);
    if (!resp.ok) {
      throw new Error('Failed to fetch token');
    }
    const { token } = await resp.json();
    return token;
  }

  createAccessManager(token) {
    const accessManager = new AccessManager(token);
    accessManager.on('tokenExpired', async () => {
      const { token } = await this.fetchToken(this.serviceSid);
      accessManager.updateToken(token);
    });
    accessManager.on('tokenUpdated', () => {
      if (this.client) {
        this.client.updateToken(this.accessManager.token);
      }
    });
    return accessManager;
  }

  createClient(token) {
    const client = new Client(token);
    client.on('connectionStateChanged', ({ connectionState }) => {
      if (
        connectionState === 'disconnected' ||
        connectionState === 'error' ||
        connectionState === 'denied'
      ) {
        this.emit('disconnected');
        this.client = undefined;
      }
    });
    return client;
  }

  unregisterEventListeners() {
    if (this.instance === undefined) {
      return;
    }

    if (this.isDoc()) {
      this.instance.removeAllListeners('updated');
      this.instance.removeAllListeners('removed');
    }

    if (this.isList() || this.isMap()) {
      this.instance.removeAllListeners('itemAdded');
      this.instance.removeAllListeners('itemRemoved');
      this.instance.removeAllListeners('itemUpdated');
      this.instance.removeAllListeners('collectionRemoved');
    }
  }

  registerEventListeners() {
    const updatedData = async () => {
      const data = await this.getValue();
      this.emit('updated', data);
    };

    if (this.isDoc()) {
      this.instance.on('updated', updatedData);
      this.instance.on('removed', () => {
        this.emit('removed');
      });
    }

    if (this.isMap() || this.isList()) {
      this.instance.on('itemAdded', updatedData);
      this.instance.on('itemRemoved', updatedData);
      this.instance.on('itemUpdated', updatedData);
      this.instance.on('collectionRemoved', () => {
        this.emit('removed');
      });
    }
  }

  async getValue() {
    if (this.instance === undefined) {
      return null;
    }

    if (this.isDoc()) {
      return { ...this.instance.descriptor };
    }

    if (this.isMap()) {
      const items = await this.instance.getItems();
      return { ...this.instance.descriptor, items: items.items };
    }

    if (this.isList()) {
      const items = await this.instance.getItems();
      return { ...this.instance.descriptor, items: items.items };
    }
  }

  isValidType(type) {
    return type === 'document' || type === 'map' || type === 'list';
  }

  isDoc() {
    return this.type === 'document';
  }

  isMap() {
    return this.type === 'map';
  }

  isList() {
    return this.type === 'list';
  }
}

export default SyncClient;
