/**
 * App constants.
 * 
 * Not dependant on other modules (no dependencies).
 */
// @ts-check
"use strict"

var C = {  // declare exported module containing constants
  APP_VERSION: '/* @echo APP_VERSION */', // WebApp: for compare with /version.json.  If mismatch, reload page.
  APP_BUILT: '/* @echo APP_BUILT */', // WebApp: for compare with /version.json.  If mismatch, reload page.
  /*@ifndef USE_CORDOVA
  USE_CORDOVA: false,
  //@endif */
  // @ifdef USE_CORDOVA
  USE_CORDOVA: true,
  //@endif */
  /*@ifndef USE_BLE
  USE_BLE: false,
  //@endif */
  // @ifdef USE_BLE
  USE_BLE: true,
  //@endif */
  /*@ifndef USE_FILESYSTEM
  USE_FILESYSTEM: false,
  //@endif */
  // @ifdef USE_FILESYSTEM
  USE_FILESYSTEM: true,
  //@endif */
  //@ifndef USE_MDNS
  USE_MDNS: false,
  //@endif */
  /* @ifdef USE_MDNS
  USE_MDNS: true,
  //@endif */
};

// Export useful stuff
export default C;