//go:build windows

// noctur-run starts Noctur with administrator rights on Windows. The app registers a
// scheduled task "noctur-run" that runs this program with highest privileges and the app's
// path as the only argument (src/main/sys/misc.ts). Before running the task, the app writes its
// own command line arguments to param.txt next to this program ("empty" when there are none);
// they are passed on as one argument, as the app expects.
//
// With "update" as the first argument it is the self-update helper instead (update.go).
//
// Written for Noctur to replace the prebuilt koala-clash-run.exe that upstream downloads
// from a moving release tag. scripts/prepare.mjs builds it with GOOS=windows.
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "update" {
		os.Exit(runUpdate(os.Args[2:], windowsSystem{}))
	}
	if err := run(); err != nil {
		showError(err.Error())
		os.Exit(1)
	}
}

func run() error {
	if len(os.Args) != 2 {
		return fmt.Errorf("expected the app path as the only argument, got %d arguments", len(os.Args)-1)
	}
	app := os.Args[1]

	self, err := os.Executable()
	if err != nil {
		return err
	}
	param := ""
	if b, err := os.ReadFile(filepath.Join(filepath.Dir(self), "param.txt")); err == nil {
		param = strings.TrimSpace(string(b))
	}

	if err := exec.Command(app, param).Start(); err != nil {
		return fmt.Errorf("could not start %s\n%v\nTry starting Noctur as administrator.", app, err)
	}
	return nil
}

func showError(message string) {
	const mbIconError = 0x10
	title, _ := syscall.UTF16PtrFromString("Noctur")
	text, _ := syscall.UTF16PtrFromString(message)
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(
		0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), mbIconError)
}
