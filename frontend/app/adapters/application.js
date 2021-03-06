import { computed } from '@ember/object';
import $ from 'jquery';
import { get } from '@ember/object';
import { inject as service } from '@ember/service';
import RESTAdapter from '@ember-data/adapter/rest';
import DataAdapterMixin from 'ember-simple-auth/mixins/data-adapter-mixin';
// import PartialModelAdapter from 'ember-data-partial-model/mixins/adapter';
import ENV from '../config/environment';

import {
  getConfiguredEnvironment,
  getSiteOrigin
} from '../utils/configuration';

import { breakPoint } from '../utils/breakPoint';

/*----------------------------------------------------------------------------*/

let trace = 1;
const dLog = console.debug;

/*----------------------------------------------------------------------------*/

var config = {
  apiServers: service(),

  /** required by DataAdapterMixin */
  authorizer: 'authorizer:application',

  session: service('session'),

  /** host and port part of the url of the API
   * @see buildURL()
   */
  x_host: function () {
    let server = this._server,
    /** similar calcs in @see services/api-servers.js : init() */
    config =  getConfiguredEnvironment(this),
    configApiHost = config.apiHost,
    /** this gets the site origin. use this if ENV.apiHost is '' (as it is in
     * production) or undefined. */
    siteOrigin = getSiteOrigin(this),
    host = server ? server.host : ENV.apiHost || siteOrigin;
    if (ENV !== config)
      breakPoint('ENV !== config', ENV, config, ENV.apiHost, configApiHost);
    console.log('app/adapters/application.js host', this, arguments, server, config, configApiHost, ENV.apiHost, host);
    return host;
  },

  get host() {
    let store = this.store,
    adapterOptions = store && store.adapterOptions,
    host = (adapterOptions && adapterOptions.host) || get(this, '_server.host');
    console.log('app/adapters/application.js host', this, store, adapterOptions, host, this._server);
    return host;
  },

  namespace: ENV.apiNamespace,

  urlForFindRecord(id, type, snapshot) {
    let url = this._super(...arguments);
    // facilitating loopback filter structure
    if (snapshot.adapterOptions && snapshot.adapterOptions.filter) {
      let queryParams = $.param(snapshot.adapterOptions);
      return `${url}?${queryParams}`;
    }
    return url;
  },

  get headers() {
    let store = this.store,
    adapterOptions = store && store.adapterOptions,
    token = this._server && this._server.token;
    dLog('headers', store, adapterOptions, this._server, token);
    return token && {
      Authorization : token
    };
  },

  /** Wrap buildURL(); get server associated with adapterOptions or query and
   * pass server as this._server through to get('host'), so that it can use server.host
   * The adapterOptions don't seem to be passed to get('host')
   */
  buildURL(modelName, id, snapshot, requestType, query) {
    let serverHandle;
    /** snapshot may be an array of snapshots.
     *  apparently snapshotRecordArray has the options, as adapterOptionsproperty,
     *   refn https://github.com/emberjs/data/blob/master/addon/-private/system/snapshot-record-array.js#L53
     */
    if (snapshot)
    {
      serverHandle = snapshot.adapterOptions || (snapshot.length && snapshot[0].adapterOptions);
      console.log('buildURL snapshot.adapterOptions', serverHandle);
    }
    else if (query)
    {
      console.log('buildURL query', query);
      serverHandle = query;
    }
    if (! serverHandle && id)
    {
      serverHandle = id;
      console.log('buildURL id', id);
    }
    // this applies when serverHandle is defined or undefined
    {
      /** block getData() is only used if allInitially (i.e. not progressive loading);
       *  so that addId is not done, so use id2Server. */
      let
        id2Server = this.get('apiServers.id2Server');
      let map = this.get('apiServers.obj2Server'),
      /** the above works for blocks; for datasets (e.g. delete), can lookup server name from snapshot.record */
      snapshotServerName = snapshot && get(snapshot, 'record.store.name'),
      servers = this.get('apiServers.servers'),
      snapshotServer = servers && servers[snapshotServerName],
      server = map.get(serverHandle) || (id && id2Server[id]) || snapshotServer;
      if (trace)
        dLog('buildURL id2Server', id2Server, map, id, server, requestType, snapshotServerName);
      /* if server is undefined or null then this code clears this._server and
       * session.requestServer, which means the default / local / primary
       * server is used.
       */
      {
        this._server = server;
        this.set('session.requestServer', server);
      }
    }
    return this._super(modelName, id, snapshot, requestType, query);
  },

  updateRecord(store, type, snapshot) {
    // updateRecord calls PUT rather than PATCH, which is
    // contrary to the record.save method documentation
    // the JSONAPI adapter calls patch, while the
    // RESTAdapter calls PUT
    let data = {};
    let serializer = store.serializerFor(type.modelName);

    serializer.serializeIntoHash(data, type, snapshot);

    let id = snapshot.id;
    let url = this.buildURL(type.modelName, id, snapshot, 'updateRecord');

    return this.ajax(url, "PATCH", { data: data });
  },

  deleteRecord(store, type, snapshot) {
    // loopback responds with 200 and a count of deleted entries
    // with the request. ember expects a 204 with an empty payload.
    return this._super(...arguments)
    .then(res => {
      if (Object.keys(res).length === 1 && res.count) {
        // Return null instead of an empty object, indicating to
        // ember a deleted record is persisted
        return null; 
      }
      return res;
    });
  }
}

var args = [/*PartialModelAdapter,*/ config]

if (window['AUTH'] !== 'NONE'){
  args.unshift(DataAdapterMixin);
}

export default RESTAdapter.extend(...args);
