const Events = require('events');
const Zookeeper = require('node-zookeeper-client');
const CreateMode = Zookeeper.CreateMode;
const uuid = require('uuid').v4;

/**
 * Returns a node style callback for the given promise resolve/reject arguments.
 * @param resolve
 * @param reject
 * @param array if we expect more than one array, resolve all given values after err, as an array. Otherwise just the first value is resolved.
 * @return {*}
 */
function resolverAsCallback(resolve, reject, array=false) {
    if(array) {
        return (err, ...values) => {
            if(err) {
                reject(err);
            }
            else {
                resolve(values);
            }
        };
    }
    else {
        return (err, value) => {
            if(err) {
                reject(err);
            }
            else {
                resolve(value);
            }
        };
    }
}
/**
 * Returns a promise that is resolved after the given timeout.
 * @param {Number} timeout ms
 * @return {Promise}
 */
function delay(timeout) {
    return new Promise(resolve => setTimeout(resolve, timeout));
}

/**
 * Returns the given promise if timeout is undefined, otherwise returns a promise that is rejected with a timeout error
 * within if the given timeout occurs before the original promise is resolved/rejected.
 * @param {Promise.<*>} promise
 * @param {Number} timeout
 * @return {Promise.<*>}
 */
function withTimeout(promise, timeout) {
    return timeout === undefined ? promise : Promise.race([
        promise,
        delay(timeout).then(_ => Promise.reject(new Error("Timeout")))
    ]);
}

class ZKCluster extends Events {
    /**
     *
     * @param {Object} conf
     * @param {string} conf.zkConnectionString ZK connection string
     * @param {Number} conf.setupTimeout Optional timeout for setup
     * @param {Number} conf.timeout Optional timeout for registering nodes and retrieving nodes during monitor
     * @param {string} conf.clusterPath where instances will be registered and the location that will be monitored,
     * defaults to 'clusters/default'
     */
    constructor(conf = {}) {
        super();
        this.clusterPath = conf.clusterPath || '/clusters/default';
        this._clusterChildListener = null;
        this.timeout = conf.timeout;
        this.setupTimeout = conf.setupTimeout;

        const client = this.client = Zookeeper.createClient(conf.zkConnectionString);
        client.on('state', state => this._onState(state));
        client.connect();
    }

    /**
     * Returns a promise that is resolved with this instance once initial setup is complete
     * You may call this method more than once, each invocation calls ZK again to verify setup.
     * @return {Promise.<ZKCluster>}
     */
    setup() {
        return withTimeout(new Promise((resolve, reject) => {
            this.client.mkdirp(this.clusterPath, resolverAsCallback(resolve, reject));
        }), this.setupTimeout).then(() => this);
    }

    /**
     * Returns promise resolved with the current node list.
     * @return {*}
     */
    getNodes() {
        const client = this.client;
        const res = withTimeout(new Promise((resolve, reject) => {
            client.getChildren(this.clusterPath,  this._clusterChildListener,  resolverAsCallback(resolve, reject));
        }), this.timeout);
        res.then(nodeList => this.emit('node-list', nodeList), err => this.emit('error', err));
        return res;
    }

    /**
     * Enables monitoring if not already enabled, and returns this.getNodes();
     * @return {*}
     */
    startMonitor() {
        if(!this._clusterChildListener) {
            this._clusterChildListener = this.getNodes.bind(this);
        }
        return this.getNodes();
    }

    _onState(state) {
        if (state !== Zookeeper.State.SYNC_CONNECTED) {
            this.emit(new Error('Connection Not Established'));
        }
    }

    /**
     * Registers a service instance with the given data
     * @param {object} instance optional data associated with the instance.
     * @return {Promise} once the given instance is registered.
     */
    registerInstance(instance) {
        if (!instance) {
            instance = {};
        }

        if (!instance.id) {
            instance.id = uuid();
        }
        else {
            instance.id = String(instance.id);
            if(instance.id.indexOf('/') !== -1) {
                throw new Error("Instance id cannot contain '/'");
            }
        }

        instance.registrationTimeUTC = Date.now();
        const instancePath = [this.clusterPath, instance.id].join('/');

        return withTimeout(new Promise((resolve, reject) => {
            this.client.create(
                instancePath, new Buffer(JSON.stringify(instance)),
                null/*ACL*/, CreateMode.EPHEMERAL,
                resolverAsCallback(resolve, reject));
        }, this.timeout).then(()=>instance));
    }

    close() {
        this.client.close();
        return this;
    }
}

module.exports = ZKCluster;