/**
 * Commonly used shared functions.
 * 
 */
// @ts-check

"use strict"

import C from "./constant.js";

const util = {}; // declare module

/**
 * Just attach the "click" event listener supplied as f to el
 * @param {?HTMLElement} el Element to attach to.
 * @param {EventListener} f  Callback function
 */
util.addClickListener = (el, f) => el && el.addEventListener("click", f, false);

/**
 * Just attach the "change" event listener supplied as f to el
 * @param {?HTMLElement} el Element to attach to.
 * @param {EventListener} f  Callback function
 */
util.addChangeListener = (el, f) => el && el.addEventListener("change", f, false);

/**
 * Util function to convert to a string.  Returns blank string if val is null or undefined.
 * @param {*} val The value to convert.
 */
util.toString = function (val) {
    if (val == null) { // (val == null) is true for both null and undefined
        return '';
    }
    return val + '';
};

/**
 * Util function to convert to a boolean.  Returns false if val is null or undefined.
 * @param {*} val The value to convert.
 */
util.toBool = function (val) {
    return !!val;
}

/**
 * Util function to convert to a number.  val could be number or string.
 * @param {?number|string=} val The value to convert.
 * @return {number} number output
 */
util.toFloat = function (val) {
    if (typeof val === 'string') { return parseFloat(val); }
    if (val == null) return 0;
    return val;
};

/**
 * Util function to convert to an integer.  val could be number or string.
 * @param {*} val The value to convert.
 * @return {number} integer
 */
util.toInt = function (val) {
    if (typeof val === 'string') { return parseInt(val, 10); }
    if (typeof val === 'number') { return Math.round(val); } // round or floor?
    return 0;
};

/**
 * Util function to validate an integer.  val could be number or string.
 * @param {*} val The value to validate.
 * @return {boolean} Is it an integer?
 */
util.isInt = function (val) {
    return (val == parseInt(val, 10)); // trick: if equals its parsed self, consider it valid integer.
};

/**
 * @param {boolean} test must evaluate to true or else error is thrown!
 * @param {string} message to log to console
 */
util.assert = function (test, message) {
    // @if DEBUG
    if (!test) throw new Error(message);
    // @endif
};

/**
 * Split log to a new console.
 * 
 * use it like this: 
 * window.console = util.splitLog(window.console, function(text){ 
 *    document.getElementById('LogDiv').insertAdjacentHTML("afterbegin", text +"\n"); // Prepend info  
 *  });
 * 
 * @param {*} oldCons should be window.console
 * @param {?function(string)=} cb send console output here too
 * returns new console, assign it to window.console
 */
util.splitLog = function (oldCons, cb) {
    /**
     * Print debug info to console and application UI.
     * @param {string} pre String to print to the log.
     * @param {string} text String to print to the log.
     */
    function myWriteLog(pre, text) {
        var dateString = (new Date()).toISOString();
        if (typeof text === "string") text = text.replace(/(\r\n|\n|\r)/gm, ""); // Remove all newlines
        cb && cb(pre + ' (' + dateString + "): " + text);
    }
    return {
        /**
         * 
         * @param {string} text 
         */
        log: function (text) {
            oldCons.log(text);
            myWriteLog("I ", text);
        },
        /**
         * 
         * @param {string} text 
         */
        info: function (text) {
            oldCons.info(text);
            myWriteLog("I ", text);
        },
        /**
         * 
         * @param {string} text 
         */
        warn: function (text) {
            oldCons.warn(text);
            myWriteLog("W ", text);
        },
        /**
         * 
         * @param {string} text 
         */
        error: function (text) {
            oldCons.error(text);
            myWriteLog("E ", text);
        }
    };
};

// @ifdef USE_FILESYSTEM
/**
 * warning, only call this after device-ready
 */
util.get_cordova_download_location = function () {

    if (cordova.platformId == "android") {
        return cordova.file.externalRootDirectory; // 'file:///storage/emulated/0/';
    }
    if (cordova.platformId == "ios") {
        return cordova.file.documentsDirectory;
    }

    return "";
}
// @endif //USE_FILESYSTEM

// @ifdef USE_FILESYSTEM
/**
 * Util function to write a text file to the local filesystem (Cordova)
 * @param {string} filename 
 * @param {string} textdata 
 * @param {!function(number,string)=} cb callback to recieve results as (bytes_written, local_filename)=>{}
 */
util.writeFile_cordova = function (filename, textdata, cb) {
    // todo: see https://stackoverflow.com/questions/19113938/downloaded-files-not-appearing-in-the-downloads-app-in-android

    var errorCallback = function (e) {
        console.error("writeFile_cordova Error: " + e.toString());
        cb && cb(0, "");
    }

    window.resolveLocalFileSystemURL(util.get_cordova_download_location(),
        function (fileSystem) {

            fileSystem.getDirectory('Download', {
                create: true,
                exclusive: false
            },
                function (directory) {
                    directory.getFile(filename, {
                        create: true,
                        exclusive: false
                    },
                        function (fileEntry) {
                            fileEntry.createWriter(function (writer) {
                                textdata = textdata || ""; // If data object is not passed in

                                writer.onwriteend = function () {
                                    console.log(textdata.length + " bytes written to " + fileEntry.nativeURL);
                                    cb && cb(textdata.length, fileEntry.nativeURL);
                                };
                                writer.seek(0);
                                var dataObj = new Blob([textdata], { type: 'text/plain' });
                                writer.write(dataObj); //You need to put the file, blob or base64 representation here.

                            }, errorCallback);
                        }, errorCallback);
                }, errorCallback);
        }, errorCallback);
}
// @endif //USE_FILESYSTEM

/**
 * Util function to prompt html browser to download a text file
 * @param {string} filename 
 * @param {string} textdata 
 */
util.invoke_save_html5 = function (filename, textdata) {
    var iframe = document.createElement('iframe'); // create a hidden iframe to prevent displaying file if 'download' not supported.
    iframe.setAttribute('name', 'hiddenFrame');
    iframe.setAttribute('style', "width:0; height:0; border:none");
    var a = document.createElement('a');
    a.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(textdata));
    a.setAttribute('download', filename);
    a.setAttribute('target', 'hiddenFrame');
    a.style.display = 'none';
    document.body.appendChild(a);
    document.body.appendChild(iframe);
    a.click();
    document.body.removeChild(a);
    document.body.removeChild(iframe);
}

/**
 * Create a date-code string from a date object.  It is based on the users local timezone.
 * @param {Date} date
 */
util.dateToCode = function (date) {
    /**@param {number} number */
    function pad(number) {
        if (number < 10) {
            return '0' + number;
        }
        return number;
    }

    return date.getFullYear() +
        '-' + pad(date.getMonth() + 1) +
        '-' + pad(date.getDate()) +
        '_' + pad(date.getHours()) +
        ':' + pad(date.getMinutes()) +
        ':' + pad(date.getSeconds()) +
        '.' + (date.getMilliseconds() / 1000).toFixed(3).slice(2, 5);
}

/**
 * Export file to save on user's local device.
 * @param {string} rFilename remote filename (base filename, will add timestamp to it)
 * @param {string} textdata 
 * @param {function(number,string)=} cb callback to recieve results as (bytes_written, local_filename)=>{}
 */
util.export_file = function (rFilename, textdata, cb) {
    var lFilename = rFilename; // generate local filename
    lFilename = lFilename.split('\\').pop().split('/').pop();  // remove path (before any / or \)
    var filename_base = lFilename.substring(0, lFilename.lastIndexOf('.'));
    filename_base += '-' + util.dateToCode(new Date); // add a date-code to filename_base
    filename_base = filename_base.replace(/([^a-z0-9_]+)/gi, '-'); // replace illegal chars
    var filename_ext = lFilename.substring(lFilename.lastIndexOf('.') + 1);
    lFilename = filename_base + '.' + filename_ext;

    if (C.USE_FILESYSTEM) {
        util.writeFile_cordova(lFilename, textdata, cb);
    } else {
        util.invoke_save_html5(lFilename, textdata);
    }
}

// Export useful stuff.
export default util;