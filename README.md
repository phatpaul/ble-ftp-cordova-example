# ble-ftp-cordova-example
Example Android/iOS Cordova App to demo the BLE-FTP service

I wrote this BLE-FTP service to transfer configuration files back-and-forth from my ESP32 to a Android/iOS App (Cordova). It can transfer large files, but the rate is pretty slow, limited by the BLE bandwidth. It works with MTU sizes from 20~512B (but performance is much better at higher MTU).

This example is to be used with 
https://github.com/eagi223/esp-idf_Bluetooth_Multi-Service
on ESP32

# Prereqs (Common for all OS and targets)
 1. Ensure you pull the most recent master branch & update the submodules ( git submodule update --recursive --init)
 2. Install node.js (once)
  - On Windows, download and install exe from website.
  - On Ubuntu 20:
```
   curl -sL https://deb.nodesource.com/setup_16.x -o nodesource_setup.sh
   sudo bash nodesource_setup.sh
   sudo apt install nodejs npm
```
  In Windows: If you want to get rid of the requirement to type npx before node commands, add this to your PATH (in User variables):
 `%USERPROFILE%\AppData\Roaming\npm`

 4. CD to this repo root directory.  (same dir as `package.json`)
 5. Install build prerequisites (once)
```sh
npm install
```

## Updating npm packages

- When building a new version, check for updates to npm packages and to npm itself.

```sh
# check global packages like npm (you may have to prefix 'sudo' on linux or macOS)
(sudo) npm install -g npm@latest
(sudo) npm upgrade -g
(sudo) npm outdated -g
# check and upgrade local packages
npm upgrade
npm audit fix
npm outdated
# (optional and risky) if you want to upgrade an outdated package x beyond "wanted":
npm install x@latest
# (that will also update the version specified in package.json)
```

# Prereqs for Android

Note: this was tested using Cordova-Android **version 11**.

- Carefully follow all instructions here to install: https://cordova.apache.org/docs/en/11.x/guide/platforms/android/
  - Android Studio, SDK Packages, SDK tools
  - JDK, Gradle
  - Set environment variables PATH, JAVA_HOME, and ANDROID_SDK_ROOT

### Windows:

- note: best to first remove all other java versions (and remove from PATH)
- Use chocolatey package manager to install stuff (Use administrative cmd prompt):
  ```bat
  choco install AdoptOpenJD11
  setx JAVA_HOME "C:\Program Files\Eclipse Adoptium\jdk-11.0.15.10-hotspot" /M
  choco install gradle
  refreshenv
  ```
- (refreshenv didn't work, i had to restart explorer.exe and restart cmd prompt)

### Linux:

```sh
sudo apt install openjdk-11-jdk
sudo apt install gradle # doesn't matter that it's an old version in the ubuntu repo, it will be upgraded as needed by gradle-wrapper
sudo add-apt-repository ppa:maarten-fonville/android-studio
sudo apt install android-studio
```

Launch Android Studio to install the SDK (using SDK 32 with cordova-android@11 )

```sh
nano ~/.bashrc
# add to the end of the file:
export JAVA_HOME=/usr/lib/jvm/java-11-openjdk-amd64
export PATH=${JAVA_HOME}/bin:${PATH}
export ANDROID_SDK_ROOT=${HOME}/Android/Sdk
export PATH=${ANDROID_SDK_ROOT}/tools:${PATH}
export PATH=${ANDROID_SDK_ROOT}/platform-tools:${PATH}
export PATH=${ANDROID_SDK_ROOT}/cmdline-tools/latest/bin/:${PATH}
export PATH=${ANDROID_SDK_ROOT}/emulator/:${PATH}
export LC_ALL=en_US.UTF-8
export LANG=en_US.UTF-8
```

`source ~/.bashrc`

# Build for Android

## Android Debug build

Note: debug build won't run on older Android devices which don't support ES6 modules

- `npm run android-debug`

- Open project in Android Studio and build/run it from there. (Cordova CLI build is not working.)

## Debug run on android (i.e. replace device for emulator)

- Build it as above and run/debug it using Android Studio

## Android debugging

### adb using USB cable

- https://duckduckgo.com/?q=adb

### adb using TCP/IP (WiFi)

- First must connect adb using USB (see above).
- In terminal on PC,

  ```
  adb -d tcpip 5555
  adb -d shell ip -f inet addr show wlan0

  (copy the IP address of the Android device shown and replace in next command)
  adb connect 192.168.2.100:5555
  ```

## Webview debugging with Chromium

- Use latest chromium browser
  - (latest linux build) https://www.chromium.org/getting-involved/download-chromium/
- adb must be running. Confirm with `adb devices`

- Launch Chromium browser (or Chrome).  
  Type in address bar: `chrome://inspect/#devices`

- Click 'inspect' to open an interactive debugger.

# Build for iOS

- Must be done on macOS (i.e. VMWare running macOS or try this [amazing docker container](https://github.com/sickcodes/Docker-OSX))

## Prereqs for iOS Build

- Install XCode

* CD to this directory. (a cordova project dir)
* Install prerequisites (once)
  ```sh
  npm install
  brew install ios-deploy
  brew install cocoapods
  brew install fastlane
  ```

## Updating npm packages

- Same as above in Common section.

## iOS Debug build

- Must be done on macOS (i.e. VMWare running macOS)

  ```sh
  npm run ios-debug
  ```

- Then open xCode project via terminal: `open platforms/ios/`

- Ensure the Signing Certificates are up to data by double-clickiing on the XCode project in the files tab on the left of the screen. On the page go to Signing & Capabilities and deselect & re-select the checkboxes.

- To debug thorugh Safari-
  Open Safari and find Develop in the main settings tabs on the top of the screen. From the dropdown select the device you want to debug and the html file.

## Debug run on iOS

- Open project in XCode and run it from there. (Cordova CLI run is not working well.)
- Ensure top directory (build target) next to device says the name of this app.
