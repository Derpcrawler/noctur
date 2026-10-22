## 1.1.2

### Fixed

- Windows: updating from inside the app installs the new version and opens Noctur again.

## 1.1.1

### Fixed

- macOS: in TUN mode, DNS lookups now go through Noctur instead of your network's DNS server. Sites that the network's DNS blocks or answers slowly load normally, which is most noticeable with a corporate VPN client such as Check Point running. Your DNS settings are restored when you disconnect or quit.

## 1.1.0

### New

- Astra Clash is now Noctur, with a new icon. Settings, profiles and autostart move over on first start.
- New interface and design.
- Calm look: a simple power switch on a still sky. Pick a look on first start or any time in Settings.
- Choose TUN or System Proxy right from Home.
- Usage bar for subscriptions with a traffic limit.
- Two palettes: Noctur and Void.
- Updates in one click: Noctur tells you on Home when a new version is out and installs it (macOS and Windows).
- New menu bar icon on macOS.

### Improved

- Better compatibility with different subscription panels.
- Easier-to-read secondary text on Profiles, Proxy Groups and Connections.
- Small interface improvements and tweaks.

### Fixed

- Bug fixes.

## 1.0.6

### Improved

- Electron 44.7.0 with the latest security fixes.
- Updated helper service.

### Fixed

- Choosing a server in the menu bar closes only the connections of its group.

## 1.0.5

### New

- Linux support: .deb, .rpm and Arch packages for x64.
- MIPS TUN stack (experimental). Mixed stays the default.

### Improved

- Small interface improvements and tweaks.

### Fixed

- Bug fixes.

## 1.0.2

- Starting or restarting the core no longer hangs when the core stays silent or fails to launch. The app checks whether the core responds and reports a failure if it does not.
- Proxy groups and rules refresh after switching profiles or saving rules, also when several of these overlap.
- Cancelling the Quit prompt no longer turns off reconnecting after the computer wakes from sleep.
- Quitting while the app reconnects after sleep no longer starts the core again.

## 1.0.1

- Downloading a newer core in Settings installs exactly the file that was checked. A file changed during the password prompt is refused, and the current core stays.
- Downloading a core also works while disconnected.
- Stopping, restarting or quitting no longer hangs when the core does not stop or does not report that it started.
- A damaged settings file is recovered from its backup instead of resetting all settings. Settings files are readable only by your user account.
- After the computer wakes from sleep, the app no longer turns the system proxy back on if you disconnected in the meantime.
- TUN mode stays on across restarts when "Take over TUN settings" is off.

## 1.0.0

First release, for macOS (Apple Silicon) and Windows (x64).
