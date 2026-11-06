// Noctur: adds or removes the macOS resolver that sends ordinary lookups into the tunnel. Lookups
// bound to one interface, such as the Wi-Fi login window's, keep using that network's own DNS.
// The installer makes this file setuid root, because only root can write to the system's network
// state. It therefore takes no servers or names from its caller: the two actions below are all it
// can do. macOS drops this state at a restart.
#include <CoreFoundation/CoreFoundation.h>
#include <SystemConfiguration/SystemConfiguration.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

#define KEY CFSTR("State:/Network/Service/noctur-tunnel-dns/DNS")

static int set_resolver(SCDynamicStoreRef store) {
  // Both are answered by mihomo inside the tunnel; keep in step with TUNNEL_DNS in system-dns.ts.
  const void *servers[] = {CFSTR("1.1.1.1"), CFSTR("77.88.8.8")};
  // An empty match domain makes this resolver answer every name without a more specific resolver.
  const void *domains[] = {CFSTR("")};
  const void *keys[] = {CFSTR("ServerAddresses"), CFSTR("SupplementalMatchDomains")};
  const void *values[] = {
      CFArrayCreate(NULL, servers, 2, &kCFTypeArrayCallBacks),
      CFArrayCreate(NULL, domains, 1, &kCFTypeArrayCallBacks),
  };
  CFDictionaryRef dns = CFDictionaryCreate(NULL, keys, values, 2, &kCFTypeDictionaryKeyCallBacks,
                                           &kCFTypeDictionaryValueCallBacks);
  return SCDynamicStoreSetValue(store, KEY, dns) ? 0 : 1;
}

static int clear_resolver(SCDynamicStoreRef store) {
  if (SCDynamicStoreRemoveValue(store, KEY)) return 0;
  return SCError() == kSCStatusNoKey ? 0 : 1;
}

int main(int argc, char **argv) {
  if (argc != 2 || (strcmp(argv[1], "set") != 0 && strcmp(argv[1], "clear") != 0)) {
    fprintf(stderr, "usage: noctur-dns set|clear\n");
    return 2;
  }
  if (setuid(0) != 0) {
    fprintf(stderr, "noctur-dns: not setuid root\n");
    return 3;
  }
  SCDynamicStoreRef store = SCDynamicStoreCreate(NULL, CFSTR("noctur-dns"), NULL, NULL);
  if (!store) {
    fprintf(stderr, "noctur-dns: %s\n", SCErrorString(SCError()));
    return 4;
  }
  int failed = strcmp(argv[1], "set") == 0 ? set_resolver(store) : clear_resolver(store);
  if (failed) fprintf(stderr, "noctur-dns: %s\n", SCErrorString(SCError()));
  return failed;
}
