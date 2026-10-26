import { createHash } from 'crypto'
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import fs from 'fs'
import AdmZip from 'adm-zip'
import path from 'path'
import zlib from 'zlib'
import { extract } from 'tar'
import { execSync } from 'child_process'

const cwd = process.cwd()
const TEMP_DIR = path.join(cwd, 'node_modules/.temp')
// Noctur: target from the arguments, so a Windows build can be prepared on a Mac.
//   node scripts/prepare.mjs [--x64|--arm64|--ia32] [--win|--mac|--linux]
const PLATFORM_ARGS = { '--win': 'win32', '--mac': 'darwin', '--linux': 'linux' }
const ARCH_ARGS = ['--x64', '--arm64', '--ia32']
let arch = process.arch
let platform = process.platform
for (const a of process.argv.slice(2)) {
  if (PLATFORM_ARGS[a]) platform = PLATFORM_ARGS[a]
  else if (ARCH_ARGS.includes(a)) arch = a.slice(2)
  else throw new Error(`unknown argument "${a}"`)
}
console.log(`[INFO]: preparing for ${platform}-${arch}`)

if (process.env.SKIP_PREPARE === '1') {
  console.log('Skipping prepare script...')
  process.exit(0)
}

// Noctur: remove binaries left by a run for another target, so a build never ships them.
for (const dir of ['sidecar', 'files']) {
  const full = path.join(cwd, 'extra', dir)
  if (!fs.existsSync(full)) continue
  for (const f of fs.readdirSync(full)) {
    if (/^(mihomo|mihomo-alpha|sparkle-service)(\.exe)?$|\.exe$/.test(f)) fs.rmSync(path.join(full, f))
  }
}

// Noctur: no alpha core is shipped. Alpha builds cannot be pinned, and the installer would make the
// core setuid root; Settings, Core downloads newer releases with a digest check instead.

/* ======= mihomo release ======= */
const MIHOMO_VERSION_URL =
  'https://github.com/MetaCubeX/mihomo/releases/latest/download/version.txt'
const MIHOMO_URL_PREFIX = `https://github.com/MetaCubeX/mihomo/releases/download`
let MIHOMO_VERSION

const MIHOMO_MAP = {
  'win32-x64': 'mihomo-windows-amd64-v1',
  'win32-ia32': 'mihomo-windows-386',
  'win32-arm64': 'mihomo-windows-arm64',
  'darwin-x64': 'mihomo-darwin-amd64-v1',
  'darwin-arm64': 'mihomo-darwin-arm64',
  'linux-x64': 'mihomo-linux-amd64-v1',
  'linux-arm64': 'mihomo-linux-arm64'
}

// Fetch the latest release version from the version.txt file
async function getLatestReleaseVersion() {
  try {
    const response = await fetch(MIHOMO_VERSION_URL, {
      method: 'GET'
    })
    let v = await response.text()
    MIHOMO_VERSION = v.trim() // Trim to remove extra whitespaces
    console.log(`Latest release version: ${MIHOMO_VERSION}`)
  } catch (error) {
    console.error('Error fetching latest release version:', error.message)
    process.exit(1)
  }
}

/*
 * check available
 */
if (!MIHOMO_MAP[`${platform}-${arch}`]) {
  throw new Error(`unsupported platform "${platform}-${arch}"`)
}

/**
 * core info
 */
function mihomo() {
  const name = MIHOMO_MAP[`${platform}-${arch}`]
  const isWin = platform === 'win32'
  const urlExt = isWin ? 'zip' : 'gz'
  const downloadURL = `${MIHOMO_URL_PREFIX}/${MIHOMO_VERSION}/${name}-${MIHOMO_VERSION}.${urlExt}`
  const exeFile = `${name}${isWin ? '.exe' : ''}`
  const zipFile = `${name}-${MIHOMO_VERSION}.${urlExt}`

  return {
    name: 'mihomo',
    targetFile: `mihomo${isWin ? '.exe' : ''}`,
    exeFile,
    zipFile,
    downloadURL
  }
}
/**
 * download sidecar and rename
 */
async function resolveSidecar(binInfo) {
  const { name, targetFile, zipFile, exeFile, downloadURL } = binInfo

  const sidecarDir = path.join(cwd, 'extra', 'sidecar')
  const sidecarPath = path.join(sidecarDir, targetFile)

  fs.mkdirSync(sidecarDir, { recursive: true })
  if (fs.existsSync(sidecarPath)) {
    fs.rmSync(sidecarPath)
  }
  const tempDir = path.join(TEMP_DIR, name)
  const tempZip = path.join(tempDir, zipFile)
  const tempExe = path.join(tempDir, exeFile)

  fs.mkdirSync(tempDir, { recursive: true })
  try {
    if (!fs.existsSync(tempZip)) {
      await downloadFile(downloadURL, tempZip)
    }

    if (zipFile.endsWith('.zip')) {
      const zip = new AdmZip(tempZip)
      zip.getEntries().forEach((entry) => {
        console.log(`[DEBUG]: "${name}" entry name`, entry.entryName)
      })
      zip.extractAllTo(tempDir, true)
      fs.renameSync(tempExe, sidecarPath)
      console.log(`[INFO]: "${name}" unzip finished`)
    } else if (zipFile.endsWith('.tgz')) {
      // tgz
      fs.mkdirSync(tempDir, { recursive: true })
      await extract({
        cwd: tempDir,
        file: tempZip
      })
      const files = fs.readdirSync(tempDir)
      console.log(`[DEBUG]: "${name}" files in tempDir:`, files)
      const extractedFile = files.find((file) => file.startsWith('虚空终端-'))
      if (extractedFile) {
        const extractedFilePath = path.join(tempDir, extractedFile)
        fs.renameSync(extractedFilePath, sidecarPath)
        console.log(`[INFO]: "${name}" file renamed to "${sidecarPath}"`)
        execSync(`chmod 755 ${sidecarPath}`)
        console.log(`[INFO]: "${name}" chmod binary finished`)
      } else {
        throw new Error(`Expected file not found in ${tempDir}`)
      }
    } else {
      // gz
      const readStream = fs.createReadStream(tempZip)
      const writeStream = fs.createWriteStream(sidecarPath)
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          console.error(`[ERROR]: "${name}" gz failed:`, error.message)
          reject(error)
        }
        readStream
          .pipe(zlib.createGunzip().on('error', onError))
          .pipe(writeStream)
          .on('finish', () => {
            console.log(`[INFO]: "${name}" gunzip finished`)
            execSync(`chmod 755 ${sidecarPath}`)
            console.log(`[INFO]: "${name}" chmod binary finished`)
            resolve()
          })
          .on('error', onError)
      })
    }
  } catch (err) {
    // 需要删除文件
    fs.rmSync(sidecarPath)
    throw err
  } finally {
    fs.rmSync(tempDir, { recursive: true })
  }
}

/**
 * download the file to the extra dir
 */
async function resolveResource(binInfo) {
  const { file, downloadURL, localFile, needExecutable = false, sha256 } = binInfo

  const resDir = path.join(cwd, 'extra', 'files')
  const targetPath = path.join(resDir, file)

  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath)
  }

  fs.mkdirSync(resDir, { recursive: true })
  if (localFile) fs.copyFileSync(localFile, targetPath)
  else await downloadFile(downloadURL, targetPath)

  // Noctur: binaries that can run as root are pinned by hash. A moved tag stops the build.
  if (sha256) {
    const actual = createHash('sha256').update(fs.readFileSync(targetPath)).digest('hex')
    if (actual !== sha256) {
      fs.rmSync(targetPath)
      throw new Error(
        `${file}: SHA-256 is ${actual}, expected ${sha256}. Review the new build, then update the hash in scripts/prepare.mjs.`
      )
    }
    console.log(`[INFO]: ${file} SHA-256 verified`)
  }

  if (needExecutable && platform !== 'win32') {
    execSync(`chmod 755 "${targetPath}"`)
    console.log(`[INFO]: ${file} chmod finished`)
  }

  console.log(`[INFO]: ${file} finished`)
}

/**
 * download file and save to `path`
 */
async function downloadFile(url, path) {
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/octet-stream' }
  })
  // Noctur: a failed download stops the script instead of being saved as the file.
  if (!response.ok) throw new Error(`download failed with HTTP ${response.status}: ${url}`)
  const buffer = await response.arrayBuffer()
  fs.writeFileSync(path, new Uint8Array(buffer))

  console.log(`[INFO]: download finished "${url}"`)
}

const resolveMmdb = () =>
  resolveResource({
    file: 'country.mmdb',
    downloadURL: `https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/country-lite.mmdb`
  })
const resolveMetadb = () =>
  resolveResource({
    file: 'geoip.metadb',
    downloadURL: `https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.metadb`
  })
const resolveGeosite = () =>
  resolveResource({
    file: 'geosite.dat',
    downloadURL: `https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat`
  })
const resolveGeoIP = () =>
  resolveResource({
    file: 'geoip.dat',
    downloadURL: `https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat`
  })
const resolveASN = () =>
  resolveResource({
    file: 'ASN.mmdb',
    downloadURL: `https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/GeoLite2-ASN.mmdb`
  })
const resolveEnableLoopback = () =>
  resolveResource({
    file: 'enableLoopback.exe',
    downloadURL: `https://github.com/Kuingsmile/uwp-tool/releases/download/latest/enableLoopback.exe`,
    // Noctur: pinned, the "latest" tag can change. Checked 2026-09-29 (release of 2023-11-22).
    sha256: 'f0c328376bd5ae0ef3b0eb19ac1f343c24a9abfe7bc1008d3b2f6ef3573d04d1'
  })
const resolveSparkleService = () => {
  const map = {
    'win32-x64': 'sparkle-service-windows-amd64-v1',
    'win32-ia32': 'sparkle-service-windows-386',
    'win32-arm64': 'sparkle-service-windows-arm64',
    'darwin-x64': 'sparkle-service-darwin-amd64-v1',
    'darwin-arm64': 'sparkle-service-darwin-arm64',
    'linux-x64': 'sparkle-service-linux-amd64-v1',
    'linux-arm64': 'sparkle-service-linux-arm64'
  }
  if (!map[`${platform}-${arch}`]) {
    throw new Error(`unsupported platform "${platform}-${arch}"`)
  }
  const base = map[`${platform}-${arch}`]
  const ext = platform === 'win32' ? '.exe' : ''

  // Noctur: pinned by hash because the pre-release tag can change and the app runs this as root.
  // All three come from the upload of 2026-10-03 (commit dbe85a6, Go 1.26.8), checked 2026-10-08.
  // Only the platforms the fork builds for are pinned.
  const pinned = {
    'darwin-arm64': '55263fa08ef9831d44a5e0b41dd2cb5b480e6b6bf9f678f87757b96f3144a5ee',
    'win32-x64': 'df7314bb79fdf4485a6adffe25b63eb7eebd5ddd3792ffcb2f6f31a616c9a9ac',
    'linux-x64': 'd87e8414f097a24b0b14f6d426ddb00a0646dd7f01bba9574659f6a0b529b691'
  }
  if (!pinned[`${platform}-${arch}`]) {
    throw new Error(`sparkle-service: no pinned SHA-256 for ${platform}-${arch}; add one in scripts/prepare.mjs`)
  }
  // NOCTUR_SPARKLE_SERVICE_DIR: a folder with the pinned builds under their release names, used
  // instead of the download once the tag has moved on. The hash is checked the same way.
  const localDir = process.env.NOCTUR_SPARKLE_SERVICE_DIR
  return resolveResource({
    file: `sparkle-service${ext}`,
    downloadURL: `https://github.com/xishang0128/sparkle-service/releases/download/pre-release/${base}${ext}`,
    localFile: localDir && path.join(localDir, `${base}${ext}`),
    needExecutable: true,
    sha256: pinned[`${platform}-${arch}`]
  })
}
// Noctur: the launcher that starts the app as administrator is built from build/runner/
// instead of downloading koala-clash-run.exe from a moving tag. Needs Go 1.21 or newer.
const resolveRunner = async () => {
  const goArch = { x64: 'amd64', ia32: '386', arm64: 'arm64' }[arch]
  const target = path.join(cwd, 'extra', 'files', 'noctur-run.exe')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  execSync(`go build -trimpath -ldflags "-H windowsgui -s -w -buildid=" -o "${target}" .`, {
    cwd: path.join(cwd, 'build', 'runner'),
    env: { ...process.env, GOOS: 'windows', GOARCH: goArch, GOAMD64: 'v1', CGO_ENABLED: '0' },
    stdio: 'inherit'
  })
  console.log(`[INFO]: noctur-run.exe built`)
}

const resolveFont = async () => {
  // const targetPath = path.join(cwd, 'src', 'renderer', 'src', 'assets', 'NotoColorEmoji.ttf')
  const targetPath = path.join(cwd, 'src', 'renderer', 'src', 'assets', 'twemoji.ttf')

  if (fs.existsSync(targetPath)) {
    return
  }
  await downloadFile(
    // 'https://github.com/googlefonts/noto-emoji/raw/main/fonts/NotoColorEmoji.ttf',
    'https://github.com/Sav22999/emoji/raw/refs/heads/master/font/twemoji.ttf',
    targetPath
  )

  console.log(`[INFO]: twemoji.ttf finished`)
}

const tasks = [
  {
    name: 'mihomo',
    func: () => getLatestReleaseVersion().then(() => resolveSidecar(mihomo())),
    retry: 5
  },
  { name: 'mmdb', func: resolveMmdb, retry: 5 },
  { name: 'metadb', func: resolveMetadb, retry: 5 },
  { name: 'geosite', func: resolveGeosite, retry: 5 },
  { name: 'geoip', func: resolveGeoIP, retry: 5 },
  { name: 'asn', func: resolveASN, retry: 5 },
  {
    name: 'font',
    func: resolveFont,
    retry: 5
  },
  {
    name: 'enableLoopback',
    func: resolveEnableLoopback,
    retry: 5,
    winOnly: true
  },
  {
    name: 'sparkle-service',
    func: resolveSparkleService,
    retry: 5
  },
  {
    name: 'runner',
    func: resolveRunner,
    retry: 1,
    winOnly: true
  }
  // Noctur: 7za.exe is not downloaded; only the removed self-update used it.
]

async function runTask() {
  const task = tasks.shift()
  if (!task) return
  if (task.winOnly && platform !== 'win32') return runTask()
  if (task.linuxOnly && platform !== 'linux') return runTask()
  if (task.unixOnly && platform === 'win32') return runTask()

  for (let i = 0; i < task.retry; i++) {
    try {
      await task.func()
      break
    } catch (err) {
      console.error(`[ERROR]: task::${task.name} try ${i} ==`, err.message)
      if (i === task.retry - 1) throw err
    }
  }
  return runTask()
}

runTask()
runTask()
