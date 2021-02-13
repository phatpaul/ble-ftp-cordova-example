/**
 * @preserve ble-ftp.js - JavaScript Library for BLE-FTP Example
 * @author Paul Abbott, 2021.
 * @version 2.0
 * @license Apache2
 */

// @ts-check
"use strict"

// Load dependencies
import util from './util.js';

const BLE_DEFAULT_BYTE_LEN = 20;

/**
 * Extract bytes from an integer value and stuff into an array.
 * @alias poco.stuffBytes
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
    array = ((array != null)) ? (array) : (new Uint8Array(BLE_DEFAULT_BYTE_LEN)); // default value if not specified
    var to = pos - 1 + bytes;  // work backwards
    for (var from = 0; from < bytes; from++) {
        array[to] = value & 0xFF;
        value >>= 8;
        to--;
    }
    return array;
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

/** Our local reference to the cordova Bluetooth-LE library.  It is loaded asynchronously so the
variable is redefined in the onDeviceReady handler. */
/**@type {?BluetoothlePlugin.Bluetoothle} */
let ble_lib = null;

let ble_mtu = 23;  // default is 23 if not requested higher.

/**
* @typedef {Object.<string, BluetoothlePlugin.ScanStatus>} BleKnownDevices
*/

/**@type {?BluetoothlePlugin.ScanStatus} */
let deviceHandle = null; // Connected BLE device Handle.

/**@type {BleKnownDevices} */
let knownDevices = {};

/**@type {?number} */
let scanTimer = null;
/**@type {?number} */
let uiInterval = null;
let ftp_xid = 0;
/**@type {?function(BleKnownDevices)=} */
let displayFn_save = null; // save callback to display BLE device list during scan

const BLE_MTU_REQ = 517; // request server to increase to as high as this.

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

const DEVINFO_SERVICE_UUID = '180a';
const DEVINFO_SERIAL_UUID = '2a25';
const DEVINFO_FIRMWARE_UUID = '2a26';
const DEVINFO_SYSID_UUID = '2a23';
const DEVINFO_SW_VERSION_UUID = '2a28';

// Private functions

/**
 * If your call fails, you can find out why by using the error object. This code shows one way to do that. We'll re-use this function throughout this example.
 * @param {*} error 
 */
function handleError(error) {
    var msg;
    if (error.error && error.message) {
        var errorItems = [];
        if (error.service) {
            errorItems.push("service: " + (error.service));
        }
        if (error.characteristic) {
            errorItems.push("characteristic: " + (error.characteristic));
        }
        msg = "Error on " + error.error + ": " + error.message + (errorItems.length && (" (" + errorItems.join(", ") + ")"));
    }
    else {
        msg = error;
    }
    console.log(msg, "error");
}

/**
 * 
 * @param {?function()=} cb Callback function on done (pass or fail) (optional).
 */
function requestMtu(cb) {
    if (cordova.platformId == "android") {
        ble_lib.mtu(
            function (mtu) {
                ble_mtu = mtu.mtu;
                console.log('ble MTU has been set to ' + ble_mtu);
                cb && cb();
            },
            function () {
                console.error('ble MTU set fail');
                cb && cb();
            },
            {
                address: deviceHandle.address,
                mtu: BLE_MTU_REQ,
            }
        );
    } else {
        cb && cb();
    }
}


function is_connected() { return (deviceHandle != null); };
function get_deviceHandle() { return deviceHandle; };
function restart() {
    if (ble_lib) {
        // make sure we disconnect when going back to the deviceHandle list page
        disconnect();
        clearFoundDevices(); // Clear the list of deviceHandle services
        startLeScan(); // Start deviceHandle discovery.
    }
}

/**
 * If your call succeeds, use result.status property to find out if Bluetooth is enabled on their device.
 * @param {{status: "enabled" | "disabled"}} result 
 */
function initializeSuccess(result) {

    if (result.status === "enabled") {

        console.log("Bluetooth is enabled.");
        console.log(result);
        // check/request permissions
        ble_lib.hasPermission(function (result) {
            if (result.hasPermission) {
                console.log('Has permission: ' + result.hasPermission)
            } else {
                console.log('Requesting permission...');
                ble_lib.requestPermission(function (result) {
                    if (result.requestPermission) {
                        console.log('Permission granted: ' + result.requestPermission);
                    } else {
                        console.log('Permission request failed' + result.requestPermission);
                    }
                });
            }
        });
        ble_lib.isLocationEnabled(function (result) {
            if (result.isLocationEnabled) {
                console.log('Location enabled: ' + result.isLocationEnabled)
            } else {
                console.log('Requesting location...');
                ble_lib.requestLocation(function (result) {
                    console.log('Location granted: ' + result.requestLocation)
                }, function () {
                    console.log('Location request failed')
                });
            }
        }, null);
    }

    else {
        /**@type {HTMLButtonElement} */
        document.getElementById("start-scan").disabled = true;

        console.log("Bluetooth is not enabled:", "status");
        console.log(result, "status");
    }
}

/**
 * Bind Event Listeners
 * @param {?function(BleKnownDevices)=} displayFn Callback function periodically called with found devices.  (knownDevices)=>{}
 * @param {?function()=} onLoaded Callback function periodically called with found devices.  (knownDevices)=>{}
 */
function bindEvents(displayFn, onLoaded) {
    displayFn_save = displayFn || displayFn_save;
    // deviceready Event Handler
    function onDeviceReady() {
        console.log('Running cordova-' + cordova.platformId + '@' + cordova.version);

        // The BLE plugin was loaded asynchronously and can here be referenced.
        ble_lib = window['bluetoothle'];

        // The BluetoothLE plugin uses an adapter to interact with each device's Bluetooth LE capability so you'll have to initialize it.
        new Promise(function (resolve) {
            ble_lib.initialize(resolve, { request: true, statusReceiver: false });
        }).then(initializeSuccess, handleError);

        onLoaded && onLoaded();
    };
    // Bind any events that are required on startup. Common events are:
    // 'load', 'deviceready', 'offline', and 'online'.
    document.addEventListener('deviceready', onDeviceReady, false);
}


/**
 * startLeScan
 */
function startLeScan() {
    stopLeScan();
    console.log('ble startScan');

    if (window.cordova.platformId === "windows") {
        // Windows devices detect only those Bluetooth LE devices that are paired to it. For Windows devices, call the retrieveConnected function.
        ble_lib.retrieveConnected(retrieveConnectedSuccess, handleError, {});
    }
    else {
        // Every time that a Bluetooth LE device is detected, the startScanSuccess callback function is called
        ble_lib.startScan(startScanSuccess, handleError, { services: [] });
    }

    /**
     * use the result object to get information about the device.  In this example, we'll add each result object to an array. We use this array to detect duplicates. 
     * We'll compare the MAC address of the current result to all result objects in the array before we add it. 
     * After we've determined that the detected device is unique, we'll call a helper function named addDevice to show that device as a button on the screen. 
     * @param {BluetoothlePlugin.ScanStatus} result 
     */
    function startScanSuccess(result) {
        console.log("startScanSuccess(" + result.status + ")");
        if (result.status === "scanStarted") {
            console.log("Scanning for devices (will continue to scan until you select a device)...", "status");
        }
        else if (result.status === "scanResult") {
            onDeviceFound(result);
        }
    }

    /**
     * Windows devices detect only those Bluetooth LE devices that are paired to it, so we called the retrieveConnected function to get paired devices.
     * If the function succeeds, we get an array of result objects.  In this example, we iterate through that array and then call a helper function named 
     * addDevice to show that device as a button on the screen.
     * @param {BluetoothlePlugin.DeviceInfo[]} result 
     */
    function retrieveConnectedSuccess(result) {

        console.log("retrieveConnectedSuccess()");
        console.log(result);

        result.forEach(function (device) {
            onDeviceFound(device);
        });
    }

    // This function is called when a device is detected
    /**
     * 
     * @param {BluetoothlePlugin.ScanStatus} r 
     */
    function onDeviceFound(r) {

        let name = r.advertisement.localName;
        // if (name == 'CC2650 SensorTag') {
        //     console.log('Found the TI SensorTag!')
        // }

        if (!(r.address in knownDevices)) {
            console.log('ble scan result: ' + r.rssi + " " + name + " " + r.address);
        }
        // Set timestamp for deviceHandle (this is used to remove
        // inactive devices).
        r.timeStamp = Date.now();
        // Insert the deviceHandle into table of found devices.
        knownDevices[r.address] = r;

    }

    //runScanTimer(); // not necessary
    if (!uiInterval) {
        console.log('ble starting UiInterval');
        uiInterval = setInterval(function () {
            displayFn_save && displayFn_save(knownDevices);
        }, 1000);
    }

};

/**
 * clearFoundDevices
 */
function clearFoundDevices() {
    knownDevices = {};
    if (typeof displayFn_save === "function") displayFn_save(knownDevices);
}

// Stop scanning for devices.
function stopLeScan() {

    function stopScanSuccess() {
    }

    console.log('ble Stopping scan...');
    new Promise(function (resolve, reject) {
        ble_lib.stopScan(resolve, reject);
    }).then(stopScanSuccess, handleError);

    if (scanTimer != null) {
        clearTimeout(scanTimer);
        scanTimer = null;
    }
    if (uiInterval != null) {
        clearInterval(uiInterval);
        uiInterval = null;
    }
};

function disconnect() {

    call_chain = [];
    chain_busy = false;
    ftp_call_chain = [];
    ftp_chain_busy = false;
    stopLeScan();
    if (deviceHandle != null) {
        new Promise(function (resolve, reject) {
            ble_lib.disconnect(resolve, reject,
                { address: deviceHandle.address });

        }).then((result) => {
            if (result.status === "disconnected") {
                console.log("Disconnected from device: " + result.address, "status");
                new Promise((resolve, reject) => {
                    ble_lib.close(resolve, reject, { // ble lib requires close after disconnect
                        address: deviceHandle.address
                    })
                }).then(() => {
                    deviceHandle = null;
                });
            }
        }, handleError);
    }

};

/**
 * Connect to a BLE device
 * @param {BluetoothlePlugin.ScanStatus|string} device Can be either object from knowndevices, or a string of the address.
 * @param {?function(Object)=} onConnected Callback function accepts argument of (device)=>{}
 * @param {?function(Error)=} onDisconnected Callback function accepts argument of (error)=>{}
 * @param {?function(Error)=} onConnectError Callback function accepts argument of (error)=>{}
 */
function connect(device, onConnected, onDisconnected, onConnectError) {

    function connectSuccess(result) {
        console.log("- " + result.status);

        if (result.status === "connected") {
            deviceHandle = device;

            requestMtu(function () {
                console.log("Getting device services...", "status");
                var platform = window.cordova.platformId;

                if (platform === "android") {

                    new Promise(function (resolve, reject) {

                        bluetoothle.discover(resolve, reject,
                            {
                                address: deviceHandle.address,
                                //clearCache: true,  // clearCache = true / false (default) Force the device to re-discover services, instead of relying on cache from previous discovery (Android only)
                            });

                    }).then(onConnected, handleError);

                }
                else {

                    new Promise(function (resolve, reject) {

                        bluetoothle.services(resolve, reject,
                            { address: deviceHandle.address });

                    }).then(onConnected, handleError);

                }

            });
        }
        else if (result.status === "disconnected") {

            console.log("Disconnected from device: " + result.address, "status");
            //deviceHandle = null;
            onDisconnected && onDisconnected(result);
        }
    }

    // Function called when a connect error occurs.
    function myOnConnectError(error) {
        console.error('ble connect error: ');
        handleError(error);
        deviceHandle = null;
        onConnectError && onConnectError(error);
    }

    if (typeof device === 'string') device = knownDevices[device];
    if (typeof device !== 'object' || !ble_lib) {
        myOnConnectError();
        return;
    };
    const address = device.address;

    console.log('ble connecting ' + address);


    //disconnect();
    stopLeScan();
    var wasConnected;
    var readSequence = Promise.resolve();

    readSequence = readSequence.then(function () {
        new Promise(function (resolve, reject) {
            bluetoothle.wasConnected(wasConnectedSuccess, handleError, { address: address });
            function wasConnectedSuccess(result) {
                wasConnected = result.wasConnected;
            }
            return resolve();
        });
    });
    readSequence.then(function () {
        new Promise(function (resolve, reject) {
            if (wasConnected == false) {
                bluetoothle.connect(resolve, reject, { address: address });
            } else {
                console.log("reconecting...");
                bluetoothle.reconnect(resolve, reject, { address: address });
            }
        }).then(connectSuccess, myOnConnectError);
    });
};

/**
 * Read the Device Info (firmware version).
 * @param {?function(Object)=} cb Callback function accepts argument of (devInfo)=>{}
 */
function readDevInfo(cb) {
    let devInfo = {};
    // Get service and characteristics.


    call_chain_add(function (next) { // push a new function onto the chain
        function devInfo_err(error) {
            console.error('ble Read characteristic failed: ');
            handleError(error);
            next(); // allow next BLE operation to run
            cb && cb(devInfo);
        }

        console.log('ble reading DevInfo');
        new Promise((resolve, reject) => {
            ble_lib.read(resolve, reject,
                { address: deviceHandle.address, service: DEVINFO_SERVICE_UUID, characteristic: DEVINFO_FIRMWARE_UUID }
            );
        }).then(function (result) {
            next(); // allow next BLE operation to run
            // Convert data to String
            let message = window.atob(result.value); // ble-lib sends data in base64, need to decode it
            devInfo.fw_version = message;
            console.log('ble FW: ' + message);
            cb && cb(devInfo);
        }, devInfo_err);
    });
}

/**
 * Common routine for BLE-FTP
 * @param {number} opcode 
 * @param {string} ftp_filename_txt the filename on remote device
 * @param {!function(number, string):*} innerfn 
 * @param {?function(string=)=} errorcb Callback function on error (optional).
 */
function commonFTP(opcode, ftp_filename_txt, innerfn, errorcb) {

    let this_ftp_xid = (ftp_xid += 1);  // use a unique transfer ID

    let cmd8;
    if (window.TextEncoder) {
        // reserve space for 2 bytes in front of filename
        cmd8 = new TextEncoder("utf-8").encode("zz" + ftp_filename_txt); // convert string to Uint8Array 
    } else {
        let utf8 = unescape(encodeURIComponent("zz" + ftp_filename_txt));
        cmd8 = new Uint8Array(utf8.length);
        for (let i = 0; i < utf8.length; i++) {
            cmd8[i] = utf8.charCodeAt(i);
        }
    }

    cmd8 = stuffBytes(opcode, FTP_OPCODE_BYTES, FTP_OPCODE_POS, cmd8);
    cmd8 = stuffBytes(this_ftp_xid, FTP_XID_BYTES, FTP_XID_POS, cmd8);

    // optional pad remaining filename bytes with 0
    let cmd8_padded = new Uint8Array(20);
    cmd8_padded.set(cmd8);

    // First have to write Read-request and Filename
    call_chain_add(function (next) { // push a new function onto the chain
        if (opcode == FTP_OPCODE_READ_REQ) {
            console.log('ble-ftp READ REQ xid:' + this_ftp_xid + ' filename:' + ftp_filename_txt);
        } else if (opcode == FTP_OPCODE_WRITE_REQ) {
            console.log('ble-ftp WRITE REQ xid:' + this_ftp_xid + ' filename:' + ftp_filename_txt);
        } else {
            console.error('ble-ftp unkown opcode');
        }

        new Promise((resolve, reject) => {
            ble_lib.write(resolve, reject, {
                address: deviceHandle.address,
                service: FTP_SERVICE_UUID,
                characteristic: FTP_DATA_UUID,
                value: ble_lib.bytesToEncodedString(cmd8_padded),
            });
        }).then(function () {
            // Now invoke inner function
            innerfn(this_ftp_xid, ftp_filename_txt);
            next(); // allow next BLE operation to run
        }, function (error) {
            console.error('ble-ftp send req failed: ');
            handleError(error);
            next(); // allow next BLE operation to run
            errorcb && errorcb();
        });
    });
}
/**
 * Read a file from FTP service.
 * @param {string} ftp_filename_txt the filename on remote device
 * @param {?function(?string)=} done_cb Callback function to recieve result text.
 */
function readFTP(ftp_filename_txt, done_cb) {

    ftp_call_chain_add(function (next_ftp) {
        // wrap done_cb with next_ftp
        /**
         * 
         * @param {?string} result_txt 
         */
        let my_done_cb = function (result_txt) {
            next_ftp(); // allow next FTP operation to run
            done_cb && done_cb(result_txt);
        }
        let result_txt = "";  // holds the (buffered) file read
        function ftp_read_inner(this_ftp_xid, ftp_filename_txt) {
            call_chain_add(function (next_ble) { // push a new function onto the chain

                new Promise((resolve, reject) => {
                    ble_lib.read(resolve, reject, {
                        address: deviceHandle.address,
                        service: FTP_SERVICE_UUID,
                        characteristic: FTP_DATA_UUID,
                    });
                }).then(
                    function (result) {
                        const data = bluetoothle.encodedStringToBytes(result.value);
                        next_ble(); // allow next BLE operation to run
                        let ftp_opcode = data[0];
                        let recv_ftp_xid = data[1];
                        if (recv_ftp_xid != this_ftp_xid) {
                            console.error("ble-ftp XID not match");
                            my_done_cb(null);
                            return;
                        }

                        // Convert data to String
                        // remove (slice) first 2 elements because they are opcode and XID.
                        let ftp_data_txt = String.fromCharCode.apply(null, data.slice(2));
                        result_txt += ftp_data_txt; // append to buffer
                        console.log('ble-ftp Read data chunk success! size: ' + ftp_data_txt.length + ' total:' + result_txt.length);
                        if (ftp_opcode == FTP_OPCODE_DATA_FINAL) {
                            my_done_cb(result_txt);
                        } else if (ftp_opcode == FTP_OPCODE_DATA_CONT) {
                            ftp_read_inner(this_ftp_xid, ftp_filename_txt);  // Recursion!!!
                        }
                    },
                    function (error) {
                        console.error('ble-ftp Read characteristic failed: ' + error);
                        next_ble(); // allow next BLE operation to run
                        my_done_cb(null);
                    }
                );
            });
        }
        commonFTP(FTP_OPCODE_READ_REQ, ftp_filename_txt, ftp_read_inner, my_done_cb);
    });
}

/**
 * Write a file to server using BLE-FTP service.
 * @param {string} ftp_filename_txt the filename on remote device
 * @param {string|File|Blob} data Either a string of text or a File object to write to BLE device.
 * @param {?function(boolean)=} done_cb Callback function on done (pass or fail) (optional).
 */
function writeFTP(ftp_filename_txt, data, done_cb) {
    ftp_call_chain_add(function (next_ftp) {
        // wrap done_cb with next_ftp
        let my_done_cb = function (result_bool) {
            next_ftp(); // allow next FTP operation to run
            done_cb && done_cb(result_bool);
        }

        let chunkSize = 512; // bytes
        let offset = 0;
        let this_ftp_xid = null;

        /**
         * 
         * @param {*} this_ftp_xid 
         * @param {*} opcode 
         * @param {*} the_data_txt 
         * @param {?function(boolean)=} chunkCb Callback function on done (pass or fail) (optional).
         */
        function writeFtpChunk(this_ftp_xid, opcode, the_data_txt, chunkCb) {
            // Write data!
            let the_data8 = new TextEncoder("utf-8").encode("zz" + the_data_txt); // convert string to Uint8Array 
            the_data8 = stuffBytes(opcode, FTP_OPCODE_BYTES, FTP_OPCODE_POS, the_data8);
            the_data8 = stuffBytes(this_ftp_xid, FTP_XID_BYTES, FTP_XID_POS, the_data8);
            call_chain_add(function (next) { // push a new function onto the chain

                new Promise((resolve, reject) => {
                    ble_lib.write(resolve, reject, {
                        address: deviceHandle.address,
                        service: FTP_SERVICE_UUID,
                        characteristic: FTP_DATA_UUID,
                        value: bluetoothle.bytesToEncodedString(the_data8)
                    });
                }).then(
                    function (result) {
                        console.log('ble-ftp Write data chunk success! offset:' + offset);
                        next(); // allow next BLE operation to run
                        chunkCb && chunkCb(true);
                    },
                    function (error) {
                        console.error('ble-ftp Write data failed: ' + error);
                        next(); // allow next BLE operation to run
                        chunkCb && chunkCb(false);
                    }
                );
            });
        }


        if (typeof data == 'string') {
            data = new Blob([data]);
        }

        let isFile = !!data && (data instanceof Blob);
        if (!isFile) {
            my_done_cb(false); // fail
        }

        // Check for the various File API support.
        if (window.File && window.FileReader && window.FileList && window.Blob) {
            // Great success! All the File APIs are supported.
        } else {
            console.error('ble-ftp The File APIs are not fully supported in this browser.');
            if (typeof my_done_cb === "function") my_done_cb(false); //fail!
            return;
        }
        let file = data;
        let fileSize = file.size;

        // Max filesize allowed
        let maxmb = 1;
        if (fileSize > maxmb * 1024 * 1024) {
            console.error('ble-ftp File size too large (> ' + maxmb + 'MB!)');
            my_done_cb(false); //fail!
            return;
        }
        let fileReadEventHandler = function (evt) {
            if (evt.target.error == null) {
                let opcode = FTP_OPCODE_DATA_CONT;
                if (offset >= fileSize) {
                    // File is already sent.  SHould not get here?
                    console.error("ble-ftp error");
                    my_done_cb(false); //fail!
                    return;
                }
                if (offset + evt.target.result.length >= fileSize) {
                    // this will be the final chunk to write
                    opcode = FTP_OPCODE_DATA_FINAL;
                }

                let chunkCb = function (success) {
                    if (success) {
                        if (opcode == FTP_OPCODE_DATA_FINAL) {
                            console.log("ble-ftp Done writing file!");
                            // exec the user supplied cb
                            my_done_cb(success); //success!
                        } else {
                            // Recursion!!
                            chunkReaderBlock(offset, chunkSize, file);
                        }
                    } else {
                        console.error("ble-ftp error");
                        my_done_cb(false); //fail!
                    }
                }

                if (offset == 0) { // first call?
                    let ftp_write_inner = function (ftp_xid, ftp_filename_txt) {
                        this_ftp_xid = ftp_xid;
                        writeFtpChunk(this_ftp_xid, opcode, evt.target.result, chunkCb);
                    }
                    commonFTP(FTP_OPCODE_WRITE_REQ, ftp_filename_txt, ftp_write_inner, my_done_cb);
                } else {
                    writeFtpChunk(this_ftp_xid, opcode, evt.target.result, chunkCb);
                }
                offset += evt.target.result.length;

                //callback(evt.target.result); // callback for handling read chunk
            } else {
                console.error("ble-ftp Read local file error: " + evt.target.error);
                my_done_cb(false); //fail!
                return;
            }
        }

        let chunkReaderBlock = function (_offset, length, _file) {
            let r = new FileReader();
            let blob = _file.slice(_offset, length + _offset);
            r.onloadend = fileReadEventHandler;  // onloadend fires for errors too.
            r.readAsText(blob);
        }

        // now let's start the read with the first block
        chunkReaderBlock(offset, chunkSize, file);
        // --> fileReadEventHandler()
        //     --> ftp_write_inner
        //         --> chunkReaderBlock  ----->>> recursion!
    });
}

// Export useful stuff
let ble = {};
ble.is_connected = is_connected;
ble.get_deviceHandle = get_deviceHandle;
ble.restart = restart;
ble.bindEvents = bindEvents;
ble.startLeScan = startLeScan;
ble.clearFoundDevices = clearFoundDevices;
ble.connect = connect;
ble.connectedDeviceHandle = deviceHandle;
ble.disconnect = disconnect;
ble.readDevInfo = readDevInfo;
ble.readFTP = readFTP;
ble.writeFTP = writeFTP;
export default ble;
