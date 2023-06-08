/**
 * @preserve ble-ftp.js - JavaScript Library for BLE-FTP Example
 * @author Paul Abbott
 * @version 3.0
 * @license Apache2
 */

// @ts-check
"use strict";

// Load dependencies
import util from './util.js';
/**
* @typedef {Object.<string, BluetoothlePlugin.ScanStatus>} BleKnownDevices
*/

// Private vars and funs

// /**@type {?BluetoothlePlugin.Bluetoothle} */
// let bluetoothle = null;
let isInit = false;
let wantScanning = false;

const BLE_STATE_DISCONNECTED = 0;
const BLE_STATE_CONNECTING = 1;
const BLE_STATE_CONNECTED = 2;
const BLE_STATE_DISCONNECTING = 3;  // for auto-reconnect logic

let my_conn_state = BLE_STATE_DISCONNECTED;

/**@type {?BluetoothlePlugin.DeviceInfo} */
let deviceHandle = null; // Connected BLE device Handle.
/**@type {?BluetoothlePlugin.DeviceInfo} */
let previousDeviceHandle = null; // just used for pause/resume connection, since plugin is broken.

/**@type {BleKnownDevices} */
let knownDevices = {};

/**@type {?number} */
let uiInterval = null;
let ftp_xid = 0;
/**@type {?function(BleKnownDevices,boolean=)=} */
let displayFn_save = null; // save callback to display BLE device list during scan
/**@type {?function():*} */
let onConnect_save = null;
/**@type {?function():*} */
let onDisconnect_save = null;

/**
  *https://github.com/espressif/esp-idf/issues/10206
  * Android recently changed the data buffer size GATT_MAX_ATTR_LEN to 512 bytes. (was 600)
  * So MTU should be 512 + 3 = 515
  */
const GATT_WRITE_MTU_OVERHEAD = 3;
const GATT_MAX_ATTR_LEN = 512;
const BLE_MTU_DEFAULT = 23;
const BLE_MTU_REQ = GATT_MAX_ATTR_LEN + GATT_WRITE_MTU_OVERHEAD; // request server to increase to as high as this.


const FTP_SERVICE_UUID = 'fffa'; // this UUID is not official!  just for testing use.
const FTP_DATA_UUID = 'fffb';
const FTP_OPCODE_READ_REQ = (0x10);
const FTP_OPCODE_WRITE_REQ = (0x20);
const FTP_OPCODE_DATA_CONT = (0x01);
const FTP_OPCODE_DATA_FINAL = (0x03);
const FTP_OPCODE_BYTES = (1);
const FTP_OPCODE_POS = (0);
const FTP_XID_BYTES = (1);
const FTP_XID_POS = (1);
const FTP_DATA_POS = (2);
const FTP_CHUNK_SIZE_MIN = BLE_MTU_DEFAULT - GATT_WRITE_MTU_OVERHEAD - FTP_OPCODE_BYTES - FTP_XID_BYTES;
const FTP_CHUNK_SIZE_MAX = GATT_MAX_ATTR_LEN - FTP_OPCODE_BYTES - FTP_XID_BYTES;
const FTP_CHUNK_SIZE_IOS = 182 - FTP_OPCODE_BYTES - FTP_XID_BYTES; // workaround ios MTU issue
let ftp_chunk_size = FTP_CHUNK_SIZE_MIN;

const DEVINFO_SERVICE_UUID = '180a';
const DEVINFO_SERIAL_UUID = '2a25';
const DEVINFO_FIRMWARE_UUID = '2a26';
const DEVINFO_HARDWARE_UUID = '2a27';
const DEVINFO_SYSID_UUID = '2a23';
const DEVINFO_SW_VERSION_UUID = '2a28';

// Private functions
// logging functions must be within each file, see https://stackoverflow.com/questions/71683202/omit-logging-messages-from-transpiled-js
const LOG_LEVEL_TRACE = 5;
const LOG_LEVEL_DEBUG = 4;
const LOG_LEVEL_INFO = 3;
const LOG_LEVEL_WARN = 2;
const LOG_LEVEL_ERROR = 1;
const LOG_LEVEL_NONE = 0;
const LOG_LOCAL_LEVEL = LOG_LEVEL_DEBUG; // set the local logging level i.e. LOG_LEVEL_DEBUG
const TAG = "ble ";  // prepend to logs
const log = {
    trace: (/**@type {?any}*/ ...any) => { },
    debug: (/**@type {?any}*/ ...any) => { },
    info: (/**@type {?any}*/ ...any) => { },
    warn: (/**@type {?any}*/ ...any) => { },
    error: (/**@type {?any}*/ ...any) => { },
};
//@if DEBUG
if (LOG_LOCAL_LEVEL >= LOG_LEVEL_TRACE) { // conditional compilation to keep the release small
    log.trace = console.trace.bind(window.console, TAG);
}
if (LOG_LOCAL_LEVEL >= LOG_LEVEL_DEBUG) { // conditional compilation to keep the release small
    log.debug = console.debug.bind(window.console, TAG);
}
//@endif

if (LOG_LOCAL_LEVEL >= LOG_LEVEL_INFO) { // conditional compilation to keep the release small
    log.info = console.info.bind(window.console, TAG);
}

if (LOG_LOCAL_LEVEL >= LOG_LEVEL_WARN) { // conditional compilation to keep the release small
    log.warn = console.warn.bind(window.console, TAG);
}

if (LOG_LOCAL_LEVEL >= LOG_LEVEL_ERROR) { // conditional compilation to keep the release small
    log.error = console.error.bind(window.console, TAG);
}

/**
 * Extract bytes from an integer value and stuff into an array.
 * @param {number} value the integer value to extract bytes from (8 ~ 32bit unsigned number).
 * @param {number} bytes number of bytes to extract and stuff.
 * @param {number} pos starting byte position to stuff in ARRAY.
 * @param {Uint8Array=} array (optional, default:{0}) the old Array to stuff bytes into (Uint8Array).
 * @return {Uint8Array} the stuffed array.
 */
function stuffBytes(value, bytes, pos, array) {
    // @if DEBUG
    if (((value == null)) || ((bytes == null)) || ((pos == null))) {
        throw ('ERROR: undefined arg!'); // Required variable is undefined
    }
    // @endif
    array = ((array != null)) ? (array) : (new Uint8Array(ftp_chunk_size)); // default value if not specified
    var to = pos - 1 + bytes;  // work backwards
    for (var from = 0; from < bytes; from++) {
        array[to] = value & 0xFF;
        value >>= 8;
        to--;
    }
    return array;
}

/**
 * Check if ble driver is already connected
 * @param {string} address 
 */
function getIsConnected(address) {
    return new Promise((resolve, reject) => {
        //if (!deviceHandle) resolve(false); - no, we want to know what the driver thinks
        window.bluetoothle.isConnected(
            (result) => resolve(result.isConnected),
            () => resolve(false),
            { address: address });
    });
}

/**
* @callback chain_cb
* @param {function()} func 
*/

/**@type {Array<chain_cb>} */
let call_chain = [];
let chain_busy = false;

function call_chain_exec() {
    if (call_chain.length > 0) {
        chain_busy = true;
        const next = call_chain.shift();
        if (typeof next === 'function') {
            next(function () { // function is shifted out and called 
                call_chain_exec(); // with recursive argument!
            });
        } else chain_busy = false;
    } else {
        chain_busy = false;
    }
}
/**
 * Add a function to the call chain and start the chain if necessary.
 * Passed in function should be in the form of (next)=>{}
 * And in function, insert this when done: next();
 * @param {chain_cb} func
 */
function call_chain_add(func) {
    call_chain.push(func); // push a new function onto the chain
    if (!chain_busy) { // a request is not already pending
        call_chain_exec(); // start the chain
    }
}

/**@type {Array<chain_cb>} */
let ftp_call_chain = [];
let ftp_chain_busy = false;

function ftp_call_chain_exec() {
    if (ftp_call_chain.length > 0) {
        ftp_chain_busy = true;
        const next = ftp_call_chain.shift();
        if (typeof next === 'function') {
            next(function () { // function is shifted out and called 
                ftp_call_chain_exec(); // with recursive argument!
            });
        } else ftp_chain_busy = false;
    } else {
        ftp_chain_busy = false;
    }
}
/**
 * Add a function to the ftp_ call chain and start the chain if necessary.
 * Passed in function should be in the form of (next)=>{}
 * And in function, insert this when done: next();
 * @param {chain_cb} func
 */
function ftp_call_chain_add(func) {
    ftp_call_chain.push(func); // push a new function onto the chain
    if (!ftp_chain_busy) { // a request is not already pending
        ftp_call_chain_exec(); // start the chain
    }
}

/**
 * 
 * @param {"high"|"balanced"|"low"} priority 
 */
function get_ble_priority(priority) {
    return new Promise((resolve) => {
        //@if DEBUG
        if (!(deviceHandle)) throw "null obj!";
        //@endif
        // request high BLE throughput for the file transfer
        window.bluetoothle.requestConnectionPriority(resolve, resolve, { // don't care if this one fails (i.e. iOS doesnt support it)
            address: deviceHandle.address,
            connectionPriority: priority
        });
    });
}

/**
 * Concatenate uuids.
 * @param {string} subuuid
 * @param {string} baseuuid
 */
function full_uuid(subuuid, baseuuid) {
    return baseuuid.slice(0, 4) + subuuid + baseuuid.slice(8);
}

/**
 * If your call fails, you can find out why by using the error object. This code shows one way to do that. We'll re-use this function throughout this example.
 * @param {BluetoothlePlugin.Error} error 
 */
function printError(error) {
    var msg;
    if (error && error.error && error.message) {
        var errorItems = [];
        if (error.service) {
            errorItems.push("service: " + (error.service));
        }
        if (error.characteristic) {
            errorItems.push("characteristic: " + (error.characteristic));
        }
        msg = "Error on " + error.error + ": " + error.message + ((errorItems.length && (" (" + errorItems.join(", ") + ")")) || "");
    }
    else {
        msg = error;
    }
    log.error(msg);
    //log.trace();

}

/**
 * 
 * @param {?BluetoothlePlugin.DeviceInfo=} result 
 */
function connectCallback(result) {
    if (result == null) return; // not sure why I'm getting called with undefined result sometimes??
    log.info(result.status);
    //const platform = window.cordova.platformId;

    if (result.status === "connected") {
        my_conn_state = BLE_STATE_CONNECTED;
        deviceHandle = result;
        ble.stopLeScan()
            .then(ble.get_ble_high_priority)
            .then(requestMtu)
            .then(() => {
                log.info("Getting device services.");
                return new Promise(
                    (resolve, reject) => {
                        //@if DEBUG
                        if (!(deviceHandle)) throw "null obj!";
                        //@endif
                        window.bluetoothle.discover(resolve, reject,
                            {
                                address: deviceHandle.address,
                                clearCache: false,  // clearCache = true / false (default) Force the device to re-discover services, instead of relying on cache from previous discovery (Android only)
                            });
                    })
                    .then(() => ble_read(FTP_SERVICE_UUID, FTP_DATA_UUID)) // try to read a char that we know should be there
                    .then(onConnect_save)
                    .catch((err) => {
                        printError(err);
                        my_disconnectCallback(); // try to disconnect->reconnect
                    });
            });
    }
    else if (result.status === "disconnected") {
        log.info("Disconnected from: " + result.address);
        if (deviceHandle && result.address == deviceHandle.address) { // only care if we get disconnected from the one we want to connect to
            my_disconnectCallback();
        }
    }
}


function my_disconnectCallback() {
    displayFn_save && displayFn_save({}, !isInit); // 2nd param is error status

    if (my_conn_state == BLE_STATE_CONNECTED && deviceHandle) { // not BLE_STATE_DISCONNECTING
        // auto-reconnect is not working, so close and retry with autoconnect:true.  https://github.com/randdusing/cordova-plugin-bluetoothle/issues/705
        previousDeviceHandle = deviceHandle;
        ble.disconnect()
            .then(() => ble.connect(previousDeviceHandle, true))
            .catch(onDisconnect_save) // reconnect failed
    } else {
        my_conn_state = BLE_STATE_DISCONNECTED;
        onDisconnect_save && onDisconnect_save();
    }
}

// the library doesn't seem to call the callback when device disconnected unexpectedly (on Lenovo TB-8504F), so added this workaround
function verifyConnected() {
    return new Promise((resolve, reject) => {
        // Is BLE enabled?
        window.bluetoothle.isEnabled(result => {
            if (!result.isEnabled) {
                isInit = false; // we thought we were connected, but BLE is not even enabled!
                return reject("BLE disabled");
            }
            if (deviceHandle == null) return reject();
            // we think we should be connected
            window.bluetoothle.isConnected(result => {
                if (!result.isConnected) {
                    // we thought we were connected, but not!
                    reject("BLE not connected");
                } else {
                    // try to read a char that we know should be there
                    ble_read_bytes(FTP_SERVICE_UUID, FTP_DATA_UUID)
                        .then(() => resolve(true))
                        .catch(reject);
                }
            }, reject, {
                address: deviceHandle.address
            });
        });
    })
}

/**
 * 
 */
function requestMtu() {
    return new Promise((resolve, reject) => {
        //@if DEBUG
        if (!(deviceHandle)) throw "null obj!";
        //@endif

        if (cordova.platformId == "android") {
            window.bluetoothle.mtu(
                function (mtu_obj) {
                    //ble_mtu = mtu.mtu;
                    log.info('MTU has been set to ' + mtu_obj.mtu);
                    if (util.isInt(mtu_obj.mtu)) {
                        ftp_chunk_size = mtu_obj.mtu - GATT_WRITE_MTU_OVERHEAD - FTP_OPCODE_BYTES - FTP_XID_BYTES;
                    }
                    if (ftp_chunk_size > FTP_CHUNK_SIZE_MAX) ftp_chunk_size = FTP_CHUNK_SIZE_MAX;
                    if (ftp_chunk_size < FTP_CHUNK_SIZE_MIN) ftp_chunk_size = FTP_CHUNK_SIZE_MIN;
                    resolve(true);
                },
                function (error) {
                    log.error('MTU set fail');
                    printError(error);
                    resolve(false);
                },
                {
                    address: deviceHandle.address,
                    mtu: BLE_MTU_REQ,
                }
            );
        } if (cordova.platformId == "ios") {
            // set MTU not needed on iOS, it is done automatically by the OS
            ftp_chunk_size = FTP_CHUNK_SIZE_IOS;
            resolve(true);
        }
    })

}

/**
 * 
 * @param {string} service 
 * @param {string} characteristic 
 * @param {Uint8Array} bytes 
 * @returns {Promise<BluetoothlePlugin.OperationResult>}
 */
function ble_write(service, characteristic, bytes) {
    return new Promise((resolve, reject) => {
        //@if DEBUG
        if (!(deviceHandle)) throw "null obj!";
        //@endif
        var params = {
            address: deviceHandle.address,
            service: service,
            characteristic: characteristic,
            value: window.bluetoothle.bytesToEncodedString(bytes),
        };
        window.bluetoothle.write((result) => {
            resolve(result);
        }, (err) => {
            reject(err);
        }, params);
    });
}

/**
 * 
 * @param {string} service 
 * @param {string} characteristic 
 * @returns {Promise<BluetoothlePlugin.OperationResult>}
 */
function ble_read(service, characteristic) {
    return new Promise((resolve, reject) => {
        //@if DEBUG
        if (!(deviceHandle)) throw "null obj!";
        //@endif
        var params = {
            address: deviceHandle.address,
            service: service,
            characteristic: characteristic,
        };
        window.bluetoothle.read((/**@type {BluetoothlePlugin.OperationResult}*/result) => {
            resolve(result);
        }, (err) => {
            reject(err);
        }, params);
    });
}

/**
 * 
 * @param {string} service 
 * @param {string} characteristic 
 * @returns {Promise<?Uint8Array>}
 */
function ble_read_bytes(service, characteristic) {
    return ble_read(service, characteristic)
        .then(result => {
            if (result.value == null || result.value == "") { // iOS returned with null, instead of call errorCallback!  Android returned "".
                return null;
            }
            return window.bluetoothle.encodedStringToBytes(result.value)
        });
}

/**
 * 
 * @param {string} service 
 * @param {string} characteristic 
 * @returns {Promise<string>}
 */
function ble_read_string(service, characteristic) {
    return ble_read(service, characteristic)
        .then(result => {
            // ble-lib sends data in base64, need to decode it to string
            let str = window.atob(result.value);
            str = str.replace(/[^a-z0-9 \.,_-]/gim, ""); // remove any bad chars
            return str.trim(); // remove any leading or trailing whitespace
        });
}

// Exported stuff
let ble = {};

ble.restart = function () {
    // make sure we disconnect when going back to the deviceHandle list page
    ble.disconnect()
        .then(ble.startLeScan);// Start deviceHandle discovery.
}

/**
 * If your call succeeds, use result.status property to find out if Bluetooth is enabled on their device.
 * @param {boolean} isEnabled 
 */
function checkPermissions(isEnabled) {
    return new Promise((main_resolve, reject) => {
        if (isEnabled) {
            log.info("Bluetooth is enabled.");

            // runtime permission checks only work on android
            if (cordova.platformId == "android") {
                Promise.resolve()
                    .then(() => {
                        return new Promise((resolve, reject) => {
                            // check/request permissions
                            window.bluetoothle.hasPermission(function (result) {
                                if (result.hasPermission) {
                                    log.info('Has BLE permission: ' + result.hasPermission);
                                    resolve(result.hasPermission);
                                } else {
                                    log.info('Requesting BLE permission...');
                                    window.bluetoothle.requestPermission(
                                        function (result) {
                                            if (result.requestPermission) {
                                                log.info('Permission BLE granted: ' + result.requestPermission);
                                                resolve(result.requestPermission);
                                            } else {
                                                log.info('Permission BLE request failed' + result.requestPermission);
                                                reject();
                                            }
                                        });
                                }
                            });
                        })
                    })
                    .then(() => {
                        return new Promise((resolve, reject) => {
                            window.bluetoothle.isLocationEnabled(function (result) {
                                if (result.isLocationEnabled) {
                                    log.info('Location enabled: ' + result.isLocationEnabled);
                                    resolve(result.isLocationEnabled);
                                } else {
                                    log.info('Requesting location...');
                                    window.bluetoothle.requestLocation(
                                        function (result) {
                                            if (result.requestLocation) {
                                                log.info('Location granted: ' + result.requestLocation);
                                                resolve(result.requestLocation);
                                            } else {
                                                reject();
                                            }
                                        }, function (error) {
                                            reject(error);
                                        });
                                }
                            }, reject);
                        })
                    })
                    .then(() => {
                        return new Promise((resolve, reject) => {
                            // check/request permissions
                            window.bluetoothle.hasPermissionBtScan(function (result) {
                                if (result.hasPermission) {
                                    log.info('Has scan permission: ' + result.hasPermission);
                                    resolve(result.hasPermission);
                                } else {
                                    log.info('Requesting scan permission...');
                                    window.bluetoothle.requestPermissionBtScan(
                                        function (result) {
                                            if (result.requestPermission) {
                                                log.info('Permission scan granted: ' + result.requestPermission);
                                                resolve(result.requestPermission);
                                            } else {
                                                log.info('Permission scan request failed' + result.requestPermission);
                                                reject();
                                            }
                                        });
                                }
                            });
                        })
                    })
                    .then(() => {
                        return new Promise((resolve, reject) => {
                            // check/request permissions
                            window.bluetoothle.hasPermissionBtConnect(function (result) {
                                if (result.hasPermission) {
                                    log.info('Has connect permission: ' + result.hasPermission);
                                    resolve(result.hasPermission);
                                } else {
                                    log.info('Requesting connect permission...');
                                    window.bluetoothle.requestPermissionBtConnect(
                                        function (result) {
                                            if (result.requestPermission) {
                                                log.info('Permission connect granted: ' + result.requestPermission);
                                                resolve(result.requestPermission);
                                            } else {
                                                log.info('Permission connect request failed' + result.requestPermission);
                                                reject();
                                            }
                                        });
                                }
                            });
                        })
                    })

                    .then(() => {
                        // All permissions are OK at this point.
                        isInit = true;
                        main_resolve(true);
                    });
            } else {
                // iOS
                isInit = true;
                main_resolve(true);
            }

        } else {
            // BLE not enabled, even after library tried to request it.
            log.info("Bluetooth is not enabled.");
            isInit = false;
            main_resolve(false);
        }
    });
}

/**
 * Bind Event Listeners
 * @param {?function(BleKnownDevices, boolean=)=} displayFn Callback function periodically called with found devices.  (knownDevices)=>{}
 * @param {?function()=} onConnect Callback function after BLE device connect.
 * @param {?function():*=} onDisconnect Callback function after BLE device disconnect.
 */
ble.bindEvents = function (displayFn, onConnect, onDisconnect) {
    if (displayFn) displayFn_save = displayFn;
    if (onConnect) onConnect_save = onConnect;
    if (onDisconnect) onDisconnect_save = onDisconnect;
}

/**
 * Initialize module (only call this once!)
 * @param {?function()=} onLoaded Callback function after 'deviceready' event.
 */
ble.init = function (onLoaded) {
    // deviceready Event Handler
    function onDeviceReady() {
        log.info('Running cordova-' + cordova.platformId + '@' + cordova.version);
        if (!window.bluetoothle) throw "missing bluetoothle plugin";

        // The BluetoothLE plugin uses an adapter to interact with each device's Bluetooth LE capability so you'll have to initialize it.
        function getAdapterInfo() {
            return new Promise((resolve, reject) => {
                window.bluetoothle.isInitialized((result1) => {
                    window.bluetoothle.isEnabled((result2) => {
                        window.bluetoothle.isScanning((result3) => {
                            var result = {
                                isInitialized: result1.isInitialized,
                                isEnabled: result2.isEnabled,
                                isScanning: result3.isScanning,
                            };
                            resolve(result);
                        });
                    });
                });
            });
        }

        /**
         * 
         * @param {function(*):void} resolve 
         */
        function _initialize(resolve) {
            getAdapterInfo().then((result) => {
                if (!result.isInitialized) {
                    var params = {
                        request: true,
                        statusReceiver: true
                    };
                    window.bluetoothle.initialize((result) => {
                        _initialize(resolve);
                    }, params);
                } else if (result.isScanning) {
                    window.bluetoothle.stopScan((result) => {
                        _initialize(resolve);
                    }, printError);
                } else {
                    resolve(result.isEnabled);
                }
            });
        }
        Promise.resolve()
            .then(() => {
                return new Promise((resolve) => {
                    _initialize(resolve);
                })
            })
            .then(checkPermissions)
            .then((enabled) => {
                if (enabled && wantScanning) {
                    ble.restart();
                }
                if (!enabled) {
                    /// dispatch the disconnected callback
                    my_disconnectCallback();
                    displayFn_save && displayFn_save({}, !isInit); // 2nd param is error status
                }
                onLoaded && onLoaded();
            }, printError);
    };
    // Bind any events that are required on startup. Common events are:
    // 'load', 'deviceready', 'offline', and 'online'.
    document.addEventListener('deviceready', onDeviceReady, false);
}


/**
 * startLeScan
 */
ble.startLeScan = function () {
    log.info('startScan');
    wantScanning = true; //  means we want to be scanning at this moment
    if (!isInit) return;


    /**
     * This function is called when a device is detected
       * @param {BluetoothlePlugin.ScanStatus} r 
     */
    function onDeviceFound(r) {
        if (!(r.address in knownDevices)) {
            log.info('scan result: ' + r.rssi + " " + r.name + " " + r.address);
        }
        // Set timestamp for deviceHandle (this is used to remove inactive devices).
        r.timeStamp = Date.now();
        // Insert (or replace) the deviceHandle into table of found devices.
        knownDevices[r.address] = r;
    }


    function scanDevices() {
        return new Promise((resolve, reject) => {
            /**
             * use the result object to get information about the device.  In this example, we'll add each result object to an array. We use this array to detect duplicates. 
             * We'll compare the MAC address of the current result to all result objects in the array before we add it. 
             * After we've determined that the detected device is unique, we'll call a helper function named addDevice to show that device as a button on the screen. 
             * @param {BluetoothlePlugin.ScanStatus} result 
             */
            function startScanSuccess(result) {
                if (result.status === "scanStarted") {
                    log.info("Scanning");
                    resolve(result);
                }
                else if (result.status === "scanResult") {
                    onDeviceFound(result);
                }
            }

            window.bluetoothle.startScan(startScanSuccess, reject, {
                services: [FTP_SERVICE_UUID],  // only return those who have this service
                "allowDuplicates": true // for iOS to keep returning scans (to update rssi)
            });
        });
    }

    /**
     * some devices detect only those Bluetooth LE devices that are paired to it, so we called the retrieveConnected function to get paired devices.
     * If the function succeeds, we get an array of result objects.  In this example, we iterate through that array and then call a helper function named 
     * addDevice to show that device as a button on the screen.
     * @param {Array<BluetoothlePlugin.DeviceInfo>} result 
     */
    function retrievePairedSuccess(result) {
        //log.info("retrievePairedSuccess()", result);

        result.forEach(function (device) {

            /**
             * Call onDevice found with separate rssi
             * @param {number} rssi 
             */
            function onGetRssi(rssi) {
                /**@type {BluetoothlePlugin.ScanStatus} */
                var scanResult = {
                    name: device.name,
                    address: device.address,
                    advertisement: '',
                    status: device.status,
                    rssi: rssi
                };
                onDeviceFound(scanResult);
            }

            // connectedSuccess doesn't return rssi, so have to ask for that separately
            window.bluetoothle.rssi(rssiSuccess =>
                onGetRssi(rssiSuccess.rssi),
                () => onGetRssi(-999), // couldn't get rssi, still display the device in the list
                { address: device.address });
        });
    }
    function getConnectedDevices() {
        return new Promise((resolve, reject) => {
            window.bluetoothle.retrieveConnected(resolve, reject, {
                services: [FTP_SERVICE_UUID],  // only return those who have this service
            });
        }).then((result) => {
            retrievePairedSuccess(result);
            return Promise.resolve();
        })
    }

    wantScanning = true; //  means we want to be scanning at this moment
    //  detect those Bluetooth LE devices that are paired to it. 
    getConnectedDevices()
        .then(scanDevices)
        .catch(printError);

    if (!uiInterval) {
        log.info('starting UiInterval');
        uiInterval = window.setInterval(function () {
            if (wantScanning) {
                // periodically update the connected device info
                getConnectedDevices();
                displayFn_save && displayFn_save(knownDevices, !isInit);
            }
        }, 1000);
    }
};

/**
 * clearFoundDevices
 */
ble.clearFoundDevices = function () {
    knownDevices = {};
    displayFn_save && displayFn_save(knownDevices, !isInit);
}

// Stop scanning for devices.
ble.stopLeScan = function () {

    log.info('Stopping scan...');
    wantScanning = false;  //  means we don't want to be scanning at this moment

    return new Promise(function (resolve, reject) {
        if (!isInit) {
            reject();
        }
        window.bluetoothle.stopScan(resolve, resolve); // don't really care if if fails
    });
};

// Disconnect by user request (don't try reconnect)
ble.disconnect = function () {
    return new Promise((resolve_main) => {
        call_chain = [];
        chain_busy = false;
        ftp_call_chain = [];
        ftp_chain_busy = false;
        my_conn_state = BLE_STATE_DISCONNECTING;

        Promise.resolve()
            .then(() => {
                const discPromise = new Promise((resolve, reject) => {
                    if (!(deviceHandle)) resolve(false);
                    else {
                        try {
                            window.bluetoothle.disconnect(resolve, resolve,
                                { address: deviceHandle.address });
                        } catch (err) { resolve(false) }
                    }
                })
                return util.timeout(discPromise, 500, { status: "timeout" }, false); // if disconnect doesn't happen after 0.5s, just keep going. (cordova plugin didn't always callback on Android)
            })
            .then((result) => {
                return new Promise((resolve, reject) => {
                    if (result.status === "disconnected") {
                        log.info("Disconnected from: " + result.address);
                    }

                    if (!(deviceHandle)) resolve(false);
                    else {
                        window.bluetoothle.close(resolve, resolve,  // ble lib requires close after disconnect
                            { address: deviceHandle.address });
                    }
                });
            }).then(() => {
                deviceHandle = null;
                resolve_main(true);
            });
    });
};

// Disconnect b/c pause application for quick reconnect
ble.pause = function () {

    // return new Promise(function (resolve, reject) {

    //     if (!(deviceHandle)) reject();
    //     else {
    //         window.bluetoothle.disconnect(resolve, resolve,
    //             { address: deviceHandle.address });
    //     }
    // });
    previousDeviceHandle = deviceHandle;
    return ble.disconnect(); // reconnect is not working, so fully close connection.  https://github.com/randdusing/cordova-plugin-bluetoothle/issues/705
};
// Resume a paused connection
ble.resume = function () {
    //ble.connect(); -- reconnect() not working

    if (previousDeviceHandle) ble.connect(previousDeviceHandle);
};

/**
 * Connect to a BLE device
 * @param {?BluetoothlePlugin.DeviceInfo|string=} to_device Can be either object from knowndevices, or a string of the address.  If null, try reconnect previous.
 * @param {boolean=} reconnect Only set true when kicked off and trying to reconnect.  This option adds a delay to initial connection.
 */
ble.connect = function (to_device, reconnect = false) {
    /**@type {?BluetoothlePlugin.DeviceInfo} */
    let device = null;
    if (!to_device && deviceHandle != null) device = deviceHandle;
    else if (typeof to_device === 'string') {
        device = knownDevices[to_device]; // look it up in the discovered dev list.
        if (device == null) device = { address: to_device }; // not discovered, just use the supplied string as address
    }
    else if (to_device) device = to_device;
    if (device == null) return;

    const address = device.address;
    log.info('connecting ' + address);
    my_conn_state = BLE_STATE_CONNECTING;


    // Function called when a connect error occurs.
    /**
     * 
     * @param {BluetoothlePlugin.Error} error 
     */
    function myOnConnectError(error) {
        printError(error);
        //deviceHandle = null;
        my_disconnectCallback();
    }

    const getWasConnected = () => new Promise((resolve, reject) =>
        window.bluetoothle.wasConnected(
            (result) =>
                resolve(result.wasConnected),
            () =>
                resolve(false), { address: address }));

    const tryConnect = () => new Promise((resolve, reject) => {
        log.info('tryConnect()');
        window.bluetoothle.connect((result) => {
            connectCallback(result);
            if (result.status == "connected") {
                resolve(result);
            }
        }, (error) => {
            myOnConnectError(error);
            reject(error);
        }, { address: address, autoConnect: reconnect });
    });

    const tryReconnect = () => new Promise((resolve, reject) => {
        log.info('tryReconnect()');
        window.bluetoothle.reconnect((result) => {
            connectCallback(result);
            if (result.status == "connected") {
                resolve(result);
            }
        }, (error) => {
            myOnConnectError(error);
            reject(error);
        }, { address: address });
    });

    ble.stopLeScan().then(() =>
        getIsConnected(address)).then(isConnected => {
            return new Promise((resolve) => {
                if (isConnected) {
                    log.info("was already connected!");
                    deviceHandle = device; // disconnect needs this
                    return ble.disconnect()
                        .then(() => resolve(false));
                } else {
                    resolve(true);
                }
            })
        })
        .then(getWasConnected).then((wasConnected) => {
            if (wasConnected) {
                // was previously connected (i.e. paused), have to call a different function.
                return tryReconnect()
                    .catch(printError);
            } else {
                // not connected, try connect first
                return tryConnect()
                    .catch(printError);
                //   .catch(tryReconnect);
            }
        })
};

/**
 * Encode text to send over BLE
 * @param {string} longtxt The message in string format.
 * 
 */
ble.encodeTxt = function (longtxt) {
    /**@type {Uint8Array} */
    let senddata = new TextEncoder().encode(longtxt); // convert string to Uint8Array
    return senddata;
};

/**
 * Read generic
 * @param {string} service_UUID
 * @param {string} char_UUID
 */
ble.readBytes = function (service_UUID, char_UUID) {
    return new Promise((resolve, reject) => {
        call_chain_add(function (next) { // push a new function onto the chain
            ble_read_bytes(service_UUID, char_UUID)
                .then(
                    function (bytes) {
                        log.info('read returned');
                        next(); // allow next BLE operation to run
                        resolve(bytes);
                    },
                    function (error) {
                        printError(error);
                        verifyConnected().then(() => {
                            next(); // allow next BLE operation to run
                            resolve(null);
                        }).catch(reject)
                    }
                );
        });
    })
}

/**
 * Write to a characteristic
 * @param {string} service_UUID
 * @param {string} char_UUID
 * @param {Uint8Array} data 
 * @param {?function(boolean)=} cb Callback function on done (pass or fail) (optional).
 */
ble.writeBytes = function (service_UUID, char_UUID, data, cb) {
    call_chain_add(function (next) { // push a new function onto the chain
        ble_write(service_UUID, char_UUID, data)
            .then(
                function (result) {
                    next(); // allow next BLE operation to run
                    cb && cb(true);
                },
                function (error) {
                    printError(error);
                    next(); // allow next BLE operation to run
                    cb && cb(false);
                }
            );
    });
}

/** 
 * @typedef {Object} DevInfo
 * @property {string=} sys_id
 * @property {string=} hw_ver
 * @property {string=} manuf
 * @property {string=} model
 * @property {string=} serial
 * @property {string=} date
 * @property {string=} name
 * @property {string=} sw_ver
 * @property {string=} fw_ver
 */
/**
 * Read the Device Info (firmware version).
 * @param {?function(?DevInfo)=} cb Callback function accepts argument of (devInfo)=>{}
 */
ble.readDevInfo = function (cb) {
    /**@type {DevInfo} */
    let devInfo = {};
    //@if DEBUG
    if (!(deviceHandle)) throw "null obj!";
    //@endif
    devInfo.name = deviceHandle.name;

    call_chain_add(function (next) { // push a new function onto the chain
        /**
         * 
         * @param {BluetoothlePlugin.Error} error 
         */
        function devInfo_err(error) {
            log.error( 'Read characteristic failed: ');
            printError(error);
            verifyConnected().then(() => {
                next(); // allow next BLE operation to run
                cb && cb(devInfo); // return partial result?
            }).catch(my_disconnectCallback)
        }

        log.info('reading DevInfo');

        // Get SW Version
        ble_read_string(DEVINFO_SERVICE_UUID, DEVINFO_SW_VERSION_UUID)
            .then((message) => {
                devInfo.sw_ver = message;
                log.info('SW: ' + devInfo.sw_ver);

                // Get sys-id
                return ble_read_bytes(DEVINFO_SERVICE_UUID, DEVINFO_SYSID_UUID);
            })
            .then((data) => {
                // Convert data to String in MAC address format
                if (data != null) {
                    devInfo.sys_id = util.bufferToMacStr(data);
                    log.info('SysID: ' + devInfo.sys_id);
                } else {
                    log.error("sys_id = null!");
                    devInfo.sys_id = '';
                }

                // Get HW version
                return ble_read_string(DEVINFO_SERVICE_UUID, DEVINFO_HARDWARE_UUID);
            })
            .then((message) => {
                devInfo.hw_ver = message;
                log.info('HW: ' + devInfo.hw_ver);

                // Get FW version
                return ble_read_string(DEVINFO_SERVICE_UUID, DEVINFO_FIRMWARE_UUID);
            })
            .then(function (message) {
                devInfo.fw_ver = message;
                log.info('FW: ' + devInfo.fw_ver);

                next(); // allow next BLE operation to run
                cb && cb(devInfo);
            })
            .catch(devInfo_err);
    });
}

/**
 * subscribe to notifications
 * @param {string} service
 * @param {string} characteristic
 * @param {?function(string)=} cb Callback function on recieved notification accepts argument of (message)=>{}
 * @returns {Promise<boolean>} the promise is only used for the setup of the notification
 */
ble.subscribe = function (service, characteristic, cb) {
    return new Promise((resolve, reject) => {
        call_chain_add(function (next) { // push a new function onto the chain
            log.info('enabling notify');
            //@if DEBUG
            if (!(deviceHandle)) throw "null obj!";
            //@endif
            window.bluetoothle.subscribe((result) => {
                // This callback is called repeatedly until disableNotification is called.
                if (result.status == "subscribed") {
                    log.info('subscribed');
                    resolve(true);
                    next();
                } else {
                    cb && cb(result.value);
                }
            }, (error) => {
                if (error.error === "isDisconnected") {
                    // this callback fires when device is disconnected (after setup)
                    my_disconnectCallback();
                } else {
                    // assume an error in setup subscribe
                    printError(error);
                    resolve(false); // but continue anyway
                    next();
                }
            },
                {
                    address: deviceHandle.address,
                    service: service,
                    characteristic: characteristic,
                }
            );
        });
    });
};

/**
 * subscribe to notifications
 * @param {string} service
 * @param {string} characteristic
 * @param {?function(Uint8Array)=} cb Callback function on recieved notification accepts argument of (uint8array)=>{}
 */
ble.subscribeBytes = function (service, characteristic, cb) {
    /**
     * @param {string} result base64 encoded string
     */
    function my_cb(result) {
        let bytes = window.bluetoothle.encodedStringToBytes(result);
        cb && cb(bytes);
    }
    return ble.subscribe(service, characteristic, my_cb);
}

/**
 * subscribe to notifications, value returned as String
 * @param {string} service
 * @param {string} characteristic
 * @param {?function(String)=} cb Callback function on recieved notification accepts argument of (String)=>{}
 */
ble.subscribeString = function (service, characteristic, cb) {
    /**
     * @param {string} result base64 encoded string
     */
    function my_cb(result) {
        const message = window.atob(result); // ble-lib sends data in base64, need to decode it
        cb && cb(message);
    }
    return ble.subscribe(service, characteristic, my_cb);
}

/**
 * Common routine for BLE-FTP
 * @param {number} opcode 
 * @param {string} ftp_filename_txt the filename on remote device
 * @param {!function(number, string):*} innerfn 
 * @param {?function(string=)=} errorcb Callback function on error (optional).
 */
function commonFTP(opcode, ftp_filename_txt, innerfn, errorcb) {

    const this_ftp_xid = (ftp_xid += 1);  // use a unique transfer ID

    let cmd8;
    // reserve space for 2 bytes in front of filename
    cmd8 = new TextEncoder().encode("zz" + ftp_filename_txt); // convert string to Uint8Array 
    cmd8 = stuffBytes(opcode, FTP_OPCODE_BYTES, FTP_OPCODE_POS, cmd8);
    cmd8 = stuffBytes(this_ftp_xid, FTP_XID_BYTES, FTP_XID_POS, cmd8);

    // optional pad remaining filename bytes with 0
    let cmd8_padded = new Uint8Array(20);
    cmd8_padded.set(cmd8);

    // First have to write Read-request and Filename
    call_chain_add(function (next) { // push a new function onto the chain
        if (opcode == FTP_OPCODE_READ_REQ) {
            log.info('ftp READ REQ xid:' + this_ftp_xid + ' filename:' + ftp_filename_txt);
        } else if (opcode == FTP_OPCODE_WRITE_REQ) {
            log.info('ftp WRITE REQ xid:' + this_ftp_xid + ' filename:' + ftp_filename_txt);
        } else {
            log.error( 'ftp unkown opcode');
        }

        ble_write(FTP_SERVICE_UUID, FTP_DATA_UUID, cmd8_padded)
            .then(() => {
                // Now invoke inner function
                innerfn(this_ftp_xid, ftp_filename_txt);
                next(); // allow next BLE operation to run
            }).catch((error) => {
                log.error( 'ftp send req failed: ');
                printError(error);
                next(); // allow next BLE operation to run
                errorcb && errorcb();
            });
    });
}
/**
 * Read a file from FTP service.
 * @param {string} ftp_filename_txt the filename on remote device
 * @param {?function(?string=)=} done_cb Callback function to recieve result text.
 */
ble.readFTP = function (ftp_filename_txt, done_cb) {

    ftp_call_chain_add(function (next_ftp) {
        // wrap done_cb with next_ftp
        /**
         * 
         * @param {?string=} result_txt 
         */
        const my_done_cb = function (result_txt) {
            ble.get_ble_balanced_priority()
                .then(() => {
                    next_ftp(); // allow next FTP operation to run
                    done_cb && done_cb(result_txt);
                });
        }
        let result_txt = "";  // holds the (buffered) file read
        /**
         * 
         * @param {number} this_ftp_xid 
         * @param {string} ftp_filename_txt 
         */
        function ftp_read_inner(this_ftp_xid, ftp_filename_txt) {
            call_chain_add(function (next_ble) { // push a new function onto the chain

                ble_read_bytes(FTP_SERVICE_UUID, FTP_DATA_UUID)
                    .then(
                        function (bytes) {
                            next_ble(); // allow next BLE operation to run
                            if (bytes == null) { // iOS returned with null, instead of call errorCallback!  Android returned "".
                                log.error( "ftp read error");
                                my_done_cb(null);
                                return;
                            }
                            const ftp_opcode = bytes[0];
                            const recv_ftp_xid = bytes[1];
                            if (recv_ftp_xid != this_ftp_xid) {
                                log.error( "ftp XID not match");
                                my_done_cb(null);
                                return;
                            }

                            // Convert data to String
                            // remove (slice) first 2 elements because they are opcode and XID.
                            let ftp_data_txt = new TextDecoder().decode(bytes.slice(2)); // use TextDecoder to support UTF-8
                            result_txt += ftp_data_txt; // append to buffer
                            log.info('ftp Read data chunk success! size: ' + ftp_data_txt.length + ' total:' + result_txt.length);
                            if (ftp_opcode == FTP_OPCODE_DATA_FINAL) {
                                my_done_cb(result_txt);
                            } else if (ftp_opcode == FTP_OPCODE_DATA_CONT) {
                                ftp_read_inner(this_ftp_xid, ftp_filename_txt);  // Recursion!!!
                            }
                        },
                        function (error) {
                            printError(error);
                            next_ble(); // allow next BLE operation to run
                            my_done_cb(null);
                        }
                    );
            });
        }

        ble.get_ble_high_priority()
            .then(() => {
                commonFTP(FTP_OPCODE_READ_REQ, ftp_filename_txt, ftp_read_inner, my_done_cb);
            });
    });
}

/**
 * Write a file to server using BLE-FTP service.
 * @param {string} ftp_filename_txt the filename on remote device
 * @param {string|File|Blob} data Either a string of text or a File object to write to BLE device.
 * @param {?function(boolean)=} done_cb Callback function on done (pass or fail) (optional).
 */
ble.writeFTP = function (ftp_filename_txt, data, done_cb) {
    ftp_call_chain_add(function (next_ftp) {
        // wrap done_cb with next_ftp
        /**
         * 
         * @param {boolean} result_bool 
         */
        const my_done_cb = function (result_bool) {
            ble.get_ble_balanced_priority()
                .then(() => {
                    next_ftp(); // allow next FTP operation to run
                    done_cb && done_cb(result_bool);
                });
        }

        let writeOffset = 0;
        let readOffset = 0;
        let readSize = 0;
        let this_ftp_xid = 0;

        /**
         * 
         * @param {number} this_ftp_xid 
         * @param {number} opcode 
         * @param {ArrayBuffer} the_data 
         * @param {?function(boolean)=} chunkCb Callback function on done (pass or fail) (optional).
         */
        function writeFtpChunk(this_ftp_xid, opcode, the_data, chunkCb) {
            // Write data!
            let the_data8 = new Uint8Array(the_data.byteLength + FTP_OPCODE_BYTES + FTP_XID_BYTES); // convert to Uint8Array
            the_data8.set(new Uint8Array(the_data), FTP_DATA_POS);
            the_data8 = stuffBytes(opcode, FTP_OPCODE_BYTES, FTP_OPCODE_POS, the_data8);
            the_data8 = stuffBytes(this_ftp_xid, FTP_XID_BYTES, FTP_XID_POS, the_data8);
            call_chain_add(function (next) { // push a new function onto the chain

                ble_write(FTP_SERVICE_UUID, FTP_DATA_UUID, the_data8)
                    .then(
                        function (result) {
                            log.info('ftp Write data chunk success! size: ' + readSize + ' readOffset: ' + readOffset + ' writeSize: ' + the_data8.length + ' writeOffset: ' + writeOffset);
                            next(); // allow next BLE operation to run
                            chunkCb && chunkCb(true);
                        },
                        function (error) {
                            printError(error);
                            next(); // allow next BLE operation to run
                            chunkCb && chunkCb(false);
                        }
                    );
            });
        }


        if (typeof data == 'string') {
            data = new Blob([
                new Uint8Array([0xEF, 0xBB, 0xBF]), // UTF-8 BOM
                data],
                { type: "text/plain;charset=utf-8" });
        }

        const isFile = !!data && (data instanceof Blob);
        if (!isFile) {
            my_done_cb(false); // fail
        }

        // Check for the various File API support.
        if (window.File && window.FileReader && window.FileList && window.Blob) {
            // Great success! All the File APIs are supported.
        } else {
            log.error( 'ftp The File APIs are not fully supported in this browser.');
            my_done_cb(false); //fail!
            return;
        }
        const file = data;
        const fileSize = file.size;

        // Max filesize allowed
        const maxmb = 1;
        if (fileSize > maxmb * 1024 * 1024) {
            log.error( 'ftp File size too large (> ' + maxmb + 'MB!)');
            my_done_cb(false); //fail!
            return;
        }

        const fileReadEventHandler = function ( /**@type {ProgressEvent<FileReader>} */ evt) {
            //@if DEBUG
            if (!(evt.target && evt.target.result)) throw "null obj!";
            //@endif
            if (evt.target.error == null && evt.target.result instanceof ArrayBuffer) {
                /**@type {ArrayBuffer} */
                let buf = evt.target.result

                let opcode = FTP_OPCODE_DATA_CONT;

                if (readOffset + buf.byteLength >= fileSize) { // must use readOffset when comparing to fileSize
                    // this will be the final chunk to write
                    opcode = FTP_OPCODE_DATA_FINAL;
                }

                /**
                 * 
                 * @param {boolean} success 
                 */
                let chunkCb = function (success) {
                    if (success) {
                        if (opcode == FTP_OPCODE_DATA_FINAL) {
                            log.info("ftp Done writing file!");
                            // exec the user supplied cb
                            my_done_cb(success); //success!
                        } else {
                            // Recursion!!
                            readSize = chunkReaderBlock(readOffset, ftp_chunk_size, file);
                        }
                    } else {
                        log.error( "ftp error");
                        my_done_cb(false); //fail!
                    }
                }

                if (writeOffset == 0) { // first call?
                    const ftp_write_inner = function (/**@type {number}*/ftp_xid) {
                        this_ftp_xid = ftp_xid;
                        writeFtpChunk(this_ftp_xid, opcode, buf, chunkCb);
                    }

                    ble.get_ble_high_priority()
                        .then(() => {
                            commonFTP(FTP_OPCODE_WRITE_REQ, ftp_filename_txt, ftp_write_inner, (error) => my_done_cb(false));
                        });
                } else {
                    writeFtpChunk(this_ftp_xid, opcode, buf, chunkCb);
                }
                writeOffset += buf.byteLength;
                readOffset += readSize;

                //callback(evt.target.result); // callback for handling read chunk
            } else {
                log.error( "ftp Read local file error: " + evt.target.error);
                my_done_cb(false); //fail!
                return;
            }
        }

        /**
         * 
         * @param {number} _offset 
         * @param {number} length 
         * @param {File|Blob} _file 
         * @returns number
         */
        let chunkReaderBlock = function (_offset, length, _file) {
            let r = new FileReader();
            let blob = _file.slice(_offset, length + _offset);
            r.onloadend = fileReadEventHandler;  // onloadend fires for errors too.
            r.readAsArrayBuffer(blob);
            return blob.size; // need to keep track of the offset as we are reading the file here, since char encoding may change the size as returned by readAsText()
        }

        // now let's start the read with the first block
        readSize = chunkReaderBlock(readOffset, ftp_chunk_size, file);
        // --> fileReadEventHandler()
        //     --> ftp_write_inner
        //         --> chunkReaderBlock  ----->>> recursion!
    });
}



ble.get_ble_high_priority = function () {
    return get_ble_priority('high');
}
ble.get_ble_balanced_priority = function () {
    return get_ble_priority('balanced');
}

export default ble;

/**@typedef {typeof ble} ble_t */