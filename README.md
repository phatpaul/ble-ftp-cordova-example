# ble-ftp-cordova-example
Example Android/iOS Cordova App to demo the BLE-FTP service

I wrote this BLE-FTP service to transfer configuration files back-and-forth from my ESP32 to a Android/iOS App (Cordova). It can transfer large files, but the rate is pretty slow, limited by the BLE bandwidth. It works with MTU sizes from 20~512B (but performance is much better at higher MTU).

This example is to be used with 
https://github.com/eagi223/esp-idf_Bluetooth_Multi-Service
on ESP32

## Prereqs
 - CD to repo root directory.  (a cordova project dir)
 - Install prerequisites (once)
 
 ```npm install```

 ```cordova platform add android```

## build for Android
### debug version on Windows CMD (note no whitespace before or after &&):
set NODE_ENV=debug&&cordova build android --device

### debug version on Windows PowerShell
$env:NODE_ENV="debug"; cordova build android --device

### debug run on android (i.e. replace device for emulator)
set NODE_ENV=debug&&cordova run android --device
or
set NODE_ENV=debug&&cordova run android --target=emulator-5554

### Android debugging

##### adb using USB cable
https://duckduckgo.com/?q=adb

##### adb using TCP/IP (WiFi)
First must connect adb using USB (see above).
In terminal on PC, 
```
adb -d tcpip 5555
adb -d shell ip -f inet addr show wlan0

(copy the IP address of the Android device shown and replace in next command)
adb connect 192.168.2.100:5555
```
#### Webview debugging with Chromium
adb must be running.  Confirm with `adb devices`

Launch Chromium browser (or Chrome).  
Type in address bar: `chrome://inspect/#devices`

Click 'inspect' to open an interactive debugger.

## build for iOS
Must be done on macOS (i.e. VMWare running macOS 10.14)

### debug build
NODE_ENV=debug cordova build ios --device

### debug run on iOS
NODE_ENV=debug cordova run ios --device

