## 1.5.0

### New

- Redesigned interface with a new Home page: your plan, the connection and the server it goes through, your proxy groups as tiles or a list, and the busiest apps.
- Your IP and the proxy's IP on Home, IPv4 and IPv6, with the provider and location. Click an address to copy it. Noctur asks before looking them up.
- Live traffic on Home, with a speed graph.
- Minimal Home: your plan, the connection, and your IP addresses and traffic below it. Choose it in Settings, Appearance.
- Connect, TUN or Proxy, and the live speed in the sidebar on every page.
- A moving gradient background, or a plain one, with live previews of the Noctur and Void skins in Settings, Appearance. The gradient can also be drawn with a dot matrix shader.
- Lightweight mode frees memory while the window is closed. It is on by default and can be turned off in Settings, General.

### Improved

- Server delays are tested after you connect and colored by speed, with timeouts clearly marked.
- Background frame rate in Settings, Appearance.
- Electron 44.10.2 with the latest security fixes.
- Small interface improvements and tweaks.

### Fixed

- macOS: Wi-Fi login pages open while connected.
- macOS: IPv6 sites work through the tunnel when your subscription turns IPv6 on.
- Bug fixes.

## 1.1.6

### Fixed

- Windows: rewrote the self-update logic and moved it from PowerShell to Go.
- Windows: if updating from inside the app does not work, download the installer from the release page and install it manually.

## 1.1.5

### New

- Proxy ports follow your subscription, unless you set them yourself in Settings.

### Improved

- Clear messages when the core file is missing or the subscription's configuration is rejected, with a link to your provider's support.
- Electron 44.9.3 with the latest security fixes.
- Smaller download and installed size.

### Fixed

- Bug fixes

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
