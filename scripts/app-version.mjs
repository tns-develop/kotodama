import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function packageVersion() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  return typeof pkg.version === 'string' ? pkg.version : '0.0.0'
}

/** 最寄りタグの `v` と、その直後のドットを外す。`v.0.4.0` も `v0.4.0` も `0.4.0`。 */
export function appVersion() {
  try {
    const tag = execFileSync('git', ['describe', '--tags', '--abbrev=0'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    const matched = tag.match(/^v\.?(\d+\.\d+\.\d+)$/)
    if (matched) return matched[1]
  } catch {
    // タグが無い、または git が無い
  }
  return packageVersion()
}

/**
 * 署名されていないと識別子が Electron のままになり、macOS の許可がビルドに結びつかない。
 * ad-hoc は識別子は付くが、更新のたびに許可が外れる。
 */
function assertMacSigned() {
  const candidates = ['dist/mac-arm64/Kotodama.app', 'dist/mac/Kotodama.app'].map((p) => join(root, p))
  const appPath = candidates.find((p) => existsSync(p))
  if (!appPath) {
    console.error('[kotodama] 署名の確認に失敗: Kotodama.app がありません')
    process.exit(1)
  }
  const result = spawnSync('codesign', ['-dv', '--verbose=4', appPath], { encoding: 'utf8' })
  const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  const unsigned =
    result.status !== 0 ||
    text.includes('Identifier=Electron') ||
    text.includes('linker-signed') ||
    text.includes('Info.plist=not bound')
  if (unsigned) {
    console.error('[kotodama] 署名されていません。macOS の許可がこのビルドに結びつきません。')
    console.error(text.trim())
    process.exit(1)
  }
  if (text.includes('Signature=adhoc')) {
    console.warn('[kotodama] ad-hoc 署名です。更新のたびに macOS の許可が外れます。')
  }
}

function runBuilder(builderArgs) {
  const version = appVersion()
  const cli = join(root, 'node_modules', 'electron-builder', 'cli.js')
  const result = spawnSync(
    process.execPath,
    [cli, ...builderArgs, `--config.extraMetadata.version=${version}`],
    { cwd: root, stdio: 'inherit' }
  )
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1)
  if (builderArgs.includes('--mac')) assertMacSigned()
}

const builderAt = process.argv.indexOf('--builder')
if (builderAt !== -1) {
  runBuilder(process.argv.slice(builderAt + 1))
} else if (process.argv[1]?.endsWith('app-version.mjs')) {
  process.stdout.write(`${appVersion()}\n`)
}
