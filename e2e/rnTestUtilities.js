require('coffeescript').register();

const _ = require('lodash');
assert = require('should/as-function');
const nodeUtil = require('util');

db = require('../../heap/back/db');
testUtil = require('../../heap/test/util');

packageJson = require('../package.json');

const SDK_VERSION = packageJson.version;
assert.exist(SDK_VERSION);

const HEAP_ENV_ID = '2084764307';

const waitIfIos = async () => {
  if (device.getPlatform() === 'ios') {
    // :HACK: Break up long URL.
    // :TODO: Remove once pixel endpoint is handling larger events again.
    console.log('Waiting 15s to flush iOS events.');
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
};

const getPlatformBoolean = boolean => {
  if (device.getPlatform() === 'ios') {
    return boolean ? '1' : '0';
  }
  return boolean.toString();
};

const flushAllRedis = nodeUtil.promisify(done =>
  db.orm.connection.sharedRedis().flushall(done)
);

const assertEvent = (err, res, check) => {
  assert.not.exist(err);
  assert(res.length).not.equal(0);

  if (_.isFunction(check)) {
    assert(res.filter(check).length).not.equal(0);
  }
};

// Get all the events from redis
const findAllEvents = async () => {
  return new Promise((resolve, reject) => {
    if (device.getPlatform() === 'android') {
      testUtil.findAndroidEventInRedisRequests({}, (err, res) => {
        resolve({ err, res });
      });
    } else if (device.getPlatform() === 'ios') {
      testUtil.findEventInRedisRequests({}, (err, res) => {
        resolve({ err, res });
      });
    } else {
      reject(new Error(`Unknown device type: ${device.getPlatform()}`));
    }
  });
};

const assertIosPixel = async (event, check) => {
  const { err, res } = await new Promise((resolve, reject) => {
    testUtil.findEventInRedisRequests(event, (err, res) => {
      resolve({ err, res });
    });
  });

  assertEvent(err, res, check);
};

const assertAndroidEvent = async (event, check) => {
  const { err, res } = await new Promise((resolve, reject) => {
    testUtil.findAndroidEventInRedisRequests(event, (err, res) => {
      resolve({ err, res });
    });
  });

  assertEvent(err, res, check);
};

const assertAndroidAutotrackHierarchy = async (expectedName, expectedProps) => {
  return assertAndroidEvent({
    envId: HEAP_ENV_ID,
    event: {
      sourceEvent: {
        name: expectedName,
        sourceName: 'react_native',
        sourceProperties: _.mapValues(expectedProps, value => {
          return { string: value };
        }),
      },
    },
  });
};

const assertAutotrackHierarchy = async (expectedName, expectedProps) => {
  if (device.getPlatform() === 'android') {
    return assertAndroidAutotrackHierarchy(expectedName, expectedProps);
  } else if (device.getPlatform() === 'ios') {
    return assertIosPixel({
      t: expectedName,
      // Convert { key1: 'value1', key2: 'value2'} to ['key1', 'value1', 'key2', 'value2'] for
      // custom props.
      source: 'react_native',
      sprops: _.flatMap(expectedProps, (value, key) => [key, value]),
    });
  } else {
    throw new Error(`Unknown device type: ${device.getPlatform()}`);
  }
};

const assertNavigationEvent = async (expectedPath, expectedType) => {
  const expectedProps = {
    action: expectedType,
    screen_path: expectedPath,
    source_version: SDK_VERSION,
  };

  return assertAutotrackHierarchy('react_navigation_screenview', expectedProps);
};

pollForSentinel = async (sentinelValue, timeout = 60000) => {
  console.log(
    `--- Waiting for ${sentinelValue} sentinel event.  This will timeout in 60s ---`
  );
  const startTick = Date.now();

  // Give it a few seconds at first.
  await new Promise(resolve => setTimeout(resolve, 3000));

  while (Date.now() - startTick <= timeout) {
    const eventName = `${sentinelValue.toUpperCase()}_SENTINEL`;
    if (device.getPlatform() === 'ios') {
      const event = {
        a: HEAP_ENV_ID,
        t: eventName,
      };

      const { iosErr, iosRes } = await new Promise((resolve, reject) => {
        testUtil.findEventInRedisRequests(event, (iosErr, iosRes) => {
          resolve({ iosErr, iosRes });
        });
      });

      if (iosRes.length != 0) {
        return;
      }
    } else if (device.getPlatform() === 'android') {
      const event = {
        envId: HEAP_ENV_ID,
        event: {
          sourceCustomEvent: {
            name: eventName,
          },
        },
      };

      const { androidErr, androidRes } = await new Promise(
        (resolve, reject) => {
          testUtil.findAndroidEventInRedisRequests(
            event,
            (androidErr, androidRes) => {
              resolve({ androidErr, androidRes });
            }
          );
        }
      );

      if (androidRes.length != 0) {
        return;
      }
    } else {
      throw new Error(`Unknown device type: ${device.getPlatform()}`);
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for sentinel event ${sentinelValue}`);
};

module.exports = {
  assertEvent,
  findAllEvents,
  assertIosPixel,
  assertAndroidEvent,
  assertAndroidAutotrackHierarchy,
  assertAutotrackHierarchy,
  assertNavigationEvent,
  pollForSentinel,
  waitIfIos,
  getPlatformBoolean,
  flushAllRedis,
  SDK_VERSION,
};
