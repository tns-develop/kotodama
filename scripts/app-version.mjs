import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
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

function runBuilder(builderArgs) {
  const version = appVersion()
  const cli = join(root, 'node_modules', 'electron-builder', 'cli.js')
  const result = spawnSync(
    process.execPath,
    [cli, ...builderArgs, `--config.extraMetadata.version=${version}`],
    { cwd: root, stdio: 'inherit' }
  )
  process.exit(result.status ?? 1)
}

const builderAt = process.argv.indexOf('--builder')
if (builderAt !== -1) {
  runBuilder(process.argv.slice(builderAt + 1))
} else if (process.argv[1]?.endsWith('app-version.mjs')) {
  process.stdout.write(`${appVersion()}\n`)
}
