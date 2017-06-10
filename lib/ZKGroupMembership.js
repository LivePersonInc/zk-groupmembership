const {EventEmitter} = require('events');
const uuid = require('uuid/v4');

const ZK_CREATE_MODE_EPHEMERAL = 1;

/**
 * Returns a node style callback for the given promise resolve/reject arguments.
 * @param resolve
 * @param reject
 * @param [array] if true all values given to the callback after err are resolved as an array. Otherwise the first value is resolved.
 * @return {*}
 */
function resolverAsCallback(resolve, reject, array = false) {
    if (array) {
        return (err, ...values) => {
            if (err) {
                reject(err);
            }
            else {
                resolve(values);
            }
        };
    }
    else {
        return (err, value) => {
            if (err) {
                reject(err);
            }
            else {
                resolve(value);
            }
        };
    }
}
function timedPromiseByCallback(executor, timeout, array = false) {
    return withTimeout(new Promise((resolve, reject) => {
        executor(resolverAsCallback(resolve, reject, array));
    }), timeout);
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
 * @param {Number} [timeout]
 * @return {Promise.<*>}
 */
function withTimeout(promise, timeout) {
    return typeof timeout === 'undefined' ? promise : Promise.race([
        promise,
        delay(timeout).then(() => Promise.reject(new Error('Timeout')))
    ]);
}

class ZKGroupMembership extends EventEmitter {
    /**
     * Creates a new ZKGroupMembership instance.
     *
     * @param {Zookeeper} client a Zookeeper client instance.
     * @param {string} [groupPath] The path to the under which members will be registered and the location that will be monitored,
     * defaults to 'groups/default'
     * @param {Object} [conf] optional timeout configuration
     * @param {Number} [conf.setupTimeout] Optional timeout for setup
     * @param {Number} [conf.timeout] Optional timeout for registering nodes and retrieving nodes during monitor
     */
    constructor(client,
                groupPath = '/groups/default',
                conf = {}) {
        super();
        this._groupPath = groupPath;
        this._timeout = conf.timeout;
        this._setupTimeout = conf.setupTimeout;
        this._membersChangedListener = null;

        this._client = client;
    }

    /**
     * Returns a promise that is resolved with this instance once initial setup is complete
     * You may call this method more than once, each invocation calls ZK again to verify setup.
     * @return {Promise.<ZKGroupMembership>}
     */
    setup() {
        return timedPromiseByCallback(cb => this._client.mkdirp(this._groupPath, cb), this._setupTimeout).then(() => this);
    }

    /**
     * Returns promise resolved with the current node list.
     * @return {*}
     */
    getMembers() {
        return timedPromiseByCallback(cb => this._client.getChildren(this._groupPath, this._membersChangedListener, cb), this._timeout);
    }

    /**
     * Enables monitoring if not already enabled. Causes emits node-list events to be emitted
     * the first time this method is invoked and upon node additions/removals with the same
     * array that would be returned by getMembers(). Errors to retrieve node lists upon change will emit an 'error' event.
     * While monitoring is enabled, any connection state change events other than SYNC_CONNECTED causes an 'error' to be emitted
     * @return {ZKGroupMembership} this
     */
    startMonitor() {
        if (!this._membersChangedListener) {
            this._membersChangedListener = () => {
                this.getMembers().then(nodeList => this.emit('members', nodeList), err => this.emit('error', err));
            };
            this._membersChangedListener();
            this._client.on('state', state => {
                if (state.name !== 'SYNC_CONNECTED') {
                    this.emit('error', new Error('Disconnected'));
                }
            }); //when we monitor, we should be aware of disconnections
        }
        return this;
    }

    /**
     * If id contains '/' returns undefined. Otherwise returns the full path in ZK to the znode for that member.
     *
     * @param id the member id
     * @return {string}
     */
    getMemberPath(id) {
        id = typeof id !== 'string' ? String(id) : id;
        return id.includes('/') ? undefined : [this._groupPath, id].join('/');
    }

    /**
     * Registers a group member with the given metadata.
     *
     * @param id the member id
     * @param {object} [data] optional data to be associated with the member. defaults to {}.
     * @return {Promise} resolved with {id, data} once the given member is registered.
     */
    registerMember(id, data = {}) {
        if (typeof id === 'undefined') {
            id = uuid();
        }
        const path = this.getMemberPath(id);
        if (!path) {
            return Promise.reject(new Error('Illegal member ID'));
        }

        data.registrationTimeUTC = Date.now();
        const asBuffer = new Buffer(JSON.stringify(data));

        return timedPromiseByCallback(
            cb => this._client.create(path, asBuffer, null/*ACL*/, ZK_CREATE_MODE_EPHEMERAL, cb), this._timeout)
            .then(() => ({ id: id,  data: data }));
    }

    /**
     * Registers a group member with the given metadata.
     *
     * @param {object | string} id optional either a id string or object metadata associated with the member (that may
     * contain an id: string field).
     * @return {Promise} resolved once the given member is registered,
     * @throws {Error} If the memberData id contains a '/'
     */
    getMemberData(id) {
        const path = this.getMemberPath(id);
        if (!path) {
            return Promise.reject(new Error('Illegal member ID'));
        }
        return timedPromiseByCallback(cb => this._client.getData(path, null, cb), this._timeout, true).then(([buffer, stat]) => {
            return { id: id,  data: JSON.parse(buffer.toString()), stat: stat };
        });
    }
}

module.exports = ZKGroupMembership;
