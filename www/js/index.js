/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
// @ts-check
"use strict";

import C from "./constant.js";
import util from './util.js';

// @ifdef USE_BLE **
import ble from './ble-ftp.js';
/** @typedef {import('./ble-ftp.js').BleKnownDevices} BleKnownDevices */
/* @endif */

/**@type {(arg0:string)=>?HTMLElement} */
const q = document.querySelector.bind(document); // shorthand
/**
 * 
 * @param {?HTMLElement} obj 
 */
function assert(obj) {
    if (!obj) throw 'obj is null!';
    const non_null_obj = obj;
    return obj;
}
/**
 * 
 * @param {string} sel 
 */
function qs(sel) {
    return assert(q(sel));
}

/**
 * Create DOM element
 *
 * Usage:
 *   let el = m('<h1>Hello</h1>');
 *   document.body.appendChild(el);
 * 
 * Copyright (C) 2011 Jed Schmidt <http://jed.is> - WTFPL
 * More: https://gist.github.com/966233
 *
 * @param {string} a Selector string
 * @param {?Document=} b
 * @param {?HTMLParagraphElement=} c
 * @param {?DocumentFragment=} d
 */
const m = function (
    a, // an HTML string
    b, // placeholder
    c, // placeholder
    d
) {
    b = document;                   // get the document,
    c = b.createElement("p");       // create a container element,
    c.innerHTML = a;                // write the HTML to it, and
    d = b.createDocumentFragment(); // create a fragment.

    while (                         // while
        b = c.firstChild              // the container element has a first child
    ) d.appendChild(b);             // append the child to the fragment,

    return d;                       // and then return the fragment.
};

// Application object.
let app = {
    /**@type {?HTMLDivElement} */
    log_div: null,
    initForms: function () {
        /**@type {NodeListOf<HTMLInputElement>} */
        const fields = document.querySelectorAll('.clearme');
        for (let i = 0; i < fields.length; i++) {
            fields[i].innerHTML = "";
            fields[i].value = "";
        }

        /**@type {NodeListOf<HTMLInputElement>} */
        const hdrs = document.querySelectorAll(".AppHeader");
        for (let i = 0; i < hdrs.length; i++) {
            hdrs[i].innerHTML = 'BLE-FTP Example -- ' + ('/* @echo APP_VERSION */' || "debug");
        }
    },
    /**
     * Clear debug info from form in application UI.
     */
    clearLog: function () {
        app.log_div.innerHTML = '';
        console.log("Log Started");
    },
    onload: function () {
        app.log_div = qs("#LogDiv");
        if (app.log_div) {
            // Clear the log textarea
            app.clearLog();
            qs("#ClearLog").addEventListener("click", function () {
                app.clearLog();
            });
            window.console = util.splitLog(window.console, function (text) {
                app.log_div.insertAdjacentHTML("afterbegin", text + "\n"); // Prepend info  
            });
        }


        app.nav_btns = document.getElementsByClassName("nav-btn");
        for (let i = 0; i < app.nav_btns.length; i++) {
            app.nav_btns[i].addEventListener("click", function (/**@type {MouseEvent}*/e) {
                if (e.target instanceof HTMLButtonElement) app.onNavBtn(e.target.id);
            })
        }

        //@ifdef USE_BLE
        if (C.USE_BLE) {
            qs("#clearBle").addEventListener("click", function () {
                //ble.clearFoundDevices();
                ble.restart();
            });

            qs("#deviceList").addEventListener("click", function (e) {

                // e.target is the clicked element!
                // search for delegate
                let el = e.target;
                do {
                    if (el.nodeName != "LI") continue;
                    // List item found!  Output the ID!
                    console.log("List item " + el.id + " was clicked!");
                    /** Handler for when deviceHandle in devices list was clicked. */
                    app.initForms();
                    ble.connect(el.id);
                    app.changePage('connected'); // make sure we are on the right page
                    app.showInfo('Connecting...');
                    return;
                } while ((el = el.parentNode));

            }, false);

            qs("#ftpInput").addEventListener("change", function () {
                let rFilename = qs("#ftpFileName").value.trim().substr(0, 18);
                let form = this;//qs("#ftpInput");
                let file = form.files[0];
                ble.writeFTP(rFilename, file, function () {
                    form.value = null;  // erase the <input> so that next onchange event can trigger if select same file again.
                });
            });

            qs("#ftpWrite").addEventListener("click", function () {
                qs("#ftpInput").click();
            });

            qs("#ftpRead").addEventListener("click", function () {
                let rFilename = qs("#ftpFileName").value.trim().substr(0, 18); // remote filename
                function myWriteFileCb(textdata) {
                    util.export_file(rFilename, textdata);
                }
                ble.readFTP(rFilename, myWriteFileCb);
            });
            // @endif

            /* Before the page closes, disconnect cleanly from the device */
            window.onbeforeunload = function () {
                ble.disconnect();
            }
            ble.startLeScan();
            app.changePage('first'); // start at connect page if USE_BLE
        }
    },



    //@ifdef USE_BLE
    /**
     * Display the BLE deviceHandle list.
     * @param {BleKnownDevices} knownDevices
     */
    displayBleDeviceList: function (knownDevices) {
        /**@type {HTMLUListElement} */
        let ul = qs("#deviceList");

        // Clear deviceHandle list.
        ul.innerHTML = "";

        ul.appendChild(m("<li data-role=\"list-divider\">RSSI Name Address</li>"));  // need escape /" inner quotes!

        let timeNow = Date.now();
        //console.log('displayDeviceList');
        for (let key in knownDevices) {
            let deviceHandle = knownDevices[key];
            let res = deviceHandle.rssi + " " + deviceHandle.name + " " + deviceHandle.address;

            let li = document.createElement("li");
            li.id = deviceHandle.address;
            let a;
            // Only show devices that are updated during the last 5 seconds.
            if (deviceHandle.timeStamp + 5000 > timeNow) {
                a = m("<b>" + res + "</b>");
            } else {
                a = m("<i>" + res + "</i>");
            }

            li.appendChild(a);
            ul.appendChild(li);
        }
    },
    //@endif


    /**
     * Print debug info to console and application UI.
     * @param {string} info
     */
    showInfo: function (info) {
        let info_el = qs("#info");
        if (info_el) info_el.innerHTML = info;
        console.log(info);
    },
    show: function (id) {
        let el = document.getElementById(id);
        if (el) el.style.display = 'block';
    },
    hide: function (id) {
        let el = document.getElementById(id);
        if (el) el.style.display = 'none';
    },
    changePage: function (pageId) {
        switch (pageId) {
            case 'connected':
                app.hide('first');
                break;
            case 'first':
                app.hide('connected');
                //@ifdef USE_BLE
                if (C.USE_BLE) {
                    ble.restart();
                }//@endif
                break;
            default:
                break;
        }
        app.show(pageId);
    },
    /**
     * 
     * @param {string} btn_name 
     */
    onNavBtn: function (btn_name) {
        if (btn_name == "changePageConnect") {
            app.changePage('first');
        } else {
            for (let i = 0; i < app.nav_btns.length; i++) {
                app.nav_btns[i].classList.remove("selected");
            }
            document.getElementById(btn_name).classList.add("selected");
            app.hide('advanced');
            switch (btn_name) {
                case "changeTabAdvanced":
                    app.show('advanced');
                    break;
                default:
            }
        }
    },
}; // end of app object  

// @ifdef USE_BLE
function BleConnectedCb(device) {
    qs("#deviceName").innerHTML = device.address + " " + device.name;
    app.showInfo('Connected');
    ble.readDevInfo(function (devInfo) {// read and display the firmware version
        qs("#FWVersion").innerHTML = devInfo.fw_ver;
    });
}
function BleDisconnectedCb(error) {
    qs("#deviceName").innerHTML = "";
    app.showInfo('Disconnected');
}
if (C.USE_BLE) {
    ble.init(app.onload);
    ble.bindEvents(app.displayBleDeviceList, BleConnectedCb, BleDisconnectedCb);
}
// @endif
