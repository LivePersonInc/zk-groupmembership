# zk-groupmembership


[![build](https://api.travis-ci.org/LivePersonInc/zk-groupmembership.svg?branch=master)](https://travis-ci.org/LivePersonInc/zk-groupmembership)
[![npm version](https://img.shields.io/npm/v/zk-groupmembership.svg)](https://www.npmjs.com/package/zk-groupmembership)
[![npm downloads](https://img.shields.io/npm/dm/zk-groupmembership.svg)](https://www.npmjs.com/package/zk-groupmembership)
[![license](https://img.shields.io/npm/l/zk-groupmembership.svg)](LICENSE)

This package allows you to initialize a member group in zookeeper, monitor its members, and register one or more members.  
This is useful for instance to manage the nodes when implementing consistent hashing.

## Usage

### ZKGroupMembership class

```js
const ZKGroupMembership = require("zk-groupmembership").ZKGroupMembership;
const Zookeeper = require('node-zookeeper-client');
console.log("Using zk-groupmembership");
const client = Zookeeper.createClient(zkConnStr);
client.connect();

const group
    = new ZKGroupMembership(client, '/groups/sharding_example_cluster', {
    timeout: 10000, //Optional timeout for registering, getting members, getting data etc
    setupTimeout: 10000, //Optional timeout for the setup call.
});

group.setup()
    .then(() => group.registerMember()) //Register a member with a generated id and no associated data
    .then((member) => {
        console.log("Registered Instance %s", member.id);
        taskSharding.selfNode = member.id;
        group.startMonitor(); //will cause the 'members', 'error' events to be emitted on the group instance.
    }).catch(err => {
    console.log("Couldn't participate in cluster:%s\%s", err.message, err.stack);
    process.exit(1);
});



```

### Events

```js
group.on('error', err => {
    console.log("Cluster Error:%s\%s", err.message, err.stack);
    process.exit(1);
});
group.on('members', nodes => {
    currentNodeCount = nodes.length;
    taskSharding.setNodes(nodes);
});

```


## Running the example

Please look [here](https://github.com/LivePersonInc/task-sharding/#running-the-example)

## Contributing

In lieu of a formal styleguide, take care to maintain the existing coding 
style. Add unit tests for any new or changed functionality, lint and test your code.

- To run lint and tests:
   
   ```sh
   npm test
   npm run lint
   ```

