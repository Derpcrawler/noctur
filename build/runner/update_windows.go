//go:build windows

package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

var (
	kernel32 = syscall.NewLazyDLL("kernel32.dll")
	shell32  = syscall.NewLazyDLL("shell32.dll")
	versionD = syscall.NewLazyDLL("version.dll")

	procOpenProcess         = kernel32.NewProc("OpenProcess")
	procWaitForSingleObject = kernel32.NewProc("WaitForSingleObject")
	procGetExitCodeProcess  = kernel32.NewProc("GetExitCodeProcess")
	procShellExecuteExW     = shell32.NewProc("ShellExecuteExW")
	procGetFileVersionSize  = versionD.NewProc("GetFileVersionInfoSizeW")
	procGetFileVersionInfo  = versionD.NewProc("GetFileVersionInfoW")
	procVerQueryValue       = versionD.NewProc("VerQueryValueW")
)

const (
	synchronize           = 0x00100000
	waitObject0           = 0
	infinite              = 0xFFFFFFFF
	errorCancelled        = 1223
	seeMaskNoCloseProcess = 0x00000040
	seeMaskNoAsync        = 0x00000100
	seeMaskFlagNoUI       = 0x00000400
	swShowNormal          = 1
)

type windowsSystem struct{}

func (windowsSystem) waitExit(pid int, timeout time.Duration) bool {
	h, _, _ := procOpenProcess.Call(synchronize, 0, uintptr(pid))
	if h == 0 {
		return true // already gone
	}
	defer syscall.CloseHandle(syscall.Handle(h))
	r, _, _ := procWaitForSingleObject.Call(h, uintptr(timeout.Milliseconds()))
	return r == waitObject0
}

// SHELLEXECUTEINFOW
type shellExecuteInfo struct {
	cbSize       uint32
	fMask        uint32
	hwnd         uintptr
	lpVerb       *uint16
	lpFile       *uint16
	lpParameters *uint16
	lpDirectory  *uint16
	nShow        int32
	hInstApp     uintptr
	lpIDList     uintptr
	lpClass      *uint16
	hkeyClass    uintptr
	dwHotKey     uint32
	hIcon        uintptr
	hProcess     syscall.Handle
}

// runAsAdmin uses the "runas" verb: without a prompt when this process already runs as
// administrator (the app normally does), with UAC otherwise. The installer requires administrator
// rights, so a plain CreateProcess from a normal process fails with ERROR_ELEVATION_REQUIRED.
func (windowsSystem) runAsAdmin(file string, args []string) (int, error) {
	verb, _ := syscall.UTF16PtrFromString("runas")
	f, err := syscall.UTF16PtrFromString(file)
	if err != nil {
		return 0, err
	}
	params, _ := syscall.UTF16PtrFromString(strings.Join(args, " "))
	info := shellExecuteInfo{
		fMask:        seeMaskNoCloseProcess | seeMaskNoAsync | seeMaskFlagNoUI,
		lpVerb:       verb,
		lpFile:       f,
		lpParameters: params,
		nShow:        swShowNormal,
	}
	info.cbSize = uint32(unsafe.Sizeof(info))
	if ok, _, e := procShellExecuteExW.Call(uintptr(unsafe.Pointer(&info))); ok == 0 {
		if errno, isErrno := e.(syscall.Errno); isErrno && errno == errorCancelled {
			return 0, errCancelled
		}
		return 0, e
	}
	if info.hProcess == 0 {
		return 0, errors.New("no process handle")
	}
	defer syscall.CloseHandle(info.hProcess)
	// Waits for the installer only, not for the new version it opens.
	procWaitForSingleObject.Call(uintptr(info.hProcess), infinite)
	var code uint32
	if ok, _, e := procGetExitCodeProcess.Call(uintptr(info.hProcess), uintptr(unsafe.Pointer(&code))); ok == 0 {
		return 0, e
	}
	return int(code), nil
}

// VS_FIXEDFILEINFO starts with dwSignature, dwStrucVersion, dwFileVersionMS, dwFileVersionLS.
func (windowsSystem) fileVersion(file string) (string, error) {
	f, err := syscall.UTF16PtrFromString(file)
	if err != nil {
		return "", err
	}
	size, _, e := procGetFileVersionSize.Call(uintptr(unsafe.Pointer(f)), 0)
	if size == 0 {
		return "", e
	}
	buf := make([]byte, size)
	if ok, _, e := procGetFileVersionInfo.Call(uintptr(unsafe.Pointer(f)), 0, size, uintptr(unsafe.Pointer(&buf[0]))); ok == 0 {
		return "", e
	}
	root, _ := syscall.UTF16PtrFromString(`\`)
	var p uintptr
	var n uint32
	if ok, _, _ := procVerQueryValue.Call(uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(root)),
		uintptr(unsafe.Pointer(&p)), uintptr(unsafe.Pointer(&n))); ok == 0 || n < 16 {
		return "", errors.New("no version information")
	}
	// p points into buf; read the fields from buf rather than through the pointer.
	off := p - uintptr(unsafe.Pointer(&buf[0]))
	if off+16 > uintptr(len(buf)) {
		return "", errors.New("bad version information")
	}
	ms := binary.LittleEndian.Uint32(buf[off+8:])
	ls := binary.LittleEndian.Uint32(buf[off+12:])
	return fmt.Sprintf("%d.%d.%d", ms>>16, ms&0xFFFF, ls>>16), nil
}

func (windowsSystem) start(file string) error {
	return exec.Command(file).Start()
}
