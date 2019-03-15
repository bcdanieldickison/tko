import * as fs from 'fs'
import * as path from 'path'
import babelMinify from 'rollup-plugin-babel-minify'
import nodeResolve from 'rollup-plugin-node-resolve'
import replace from 'rollup-plugin-replace'
import typescript from 'rollup-plugin-typescript2'
import license from 'rollup-plugin-license'

const pkgJson = fs.readFileSync(`${process.cwd()}/package.json`, {encoding: 'utf8'})
const pkg = JSON.parse(pkgJson)

const replacerPlugin = require('./tools/rollup.replacerPlugin')

const { LERNA_PACKAGE_NAME, LERNA_ROOT_PATH } = process.env
const TKO_MODULES = getTkoModules()
const BROWSER_PACKAGES = [
  'build.knockout',
  'build.reference'
]
const IS_BROWSER_BUNDLE = BROWSER_PACKAGES.includes(getPackageName())

/**
 * Expect rollup to be called by either Lerna from the monorepo root, or
 * by the user in a specific directory.
 */
function getMonorepoRoot () {
  return LERNA_ROOT_PATH || path.join(process.cwd(), '..', '..')
}

function getPackageName () {
  return (LERNA_PACKAGE_NAME || '').replace('@tko/', '') || process.cwd().split(path.sep).pop()
}

function getPackageRoot () {
  return path.join(getMonorepoRoot(), 'packages', getPackageName())
}

function getIndexExtension () {
  return fs.readdirSync(path.join(getPackageRoot(), 'src'))
    .find((f) => f.startsWith('index'))
    .match(/\.(ts|js)/)[1]
}

const banner = `/*!
 * <%= pkg.description %> 🥊  <%= pkg.name %>@${pkg.version}
 * (c) The Knockout.js Team - ${pkg.homepage}
 * License: ${pkg.licenses[0].type} (${pkg.licenses[0].url})
 */
`

/* Use TypeScript instead of babel for transpilation for IE6 compat, plus it's faster */
const TYPESCRIPT_CONFIG = {
  include: ['**/*.js', '**/*.ts'],
  exclude: 'node_modules',
  typescript: require('typescript')
}

/* Plugins used for all builds */
const UNIVERSAL_PLUGINS = [
  /* Replace {{VERSION}} with pkg.json's `version` */
  replace({
    delimiters: ['{{', '}}'],
    VERSION: pkg.version
  }),
  nodeResolve({ module: true }),
  license({ sourcemap: true, banner })
]

function getConfigs () {
  // Respect a `--es6` option to speed up compilation during e.g.
  // testing.
  if (process.argv.includes('--es6')) {
    return createRollupConfig()
  }
  return [
    /* tko.<module?>.es6.js */
    createRollupConfig(),
    /* tko.<module?>.js */
    createRollupConfig({ transpile: true }),
    ...(IS_BROWSER_BUNDLE
      ? [
        /* tko.es6.min.js */
        createRollupConfig({ minify: true }),
        /* tko.min.js */
        createRollupConfig({ minify: true, transpile: true })
      ]
      : []
    )
  ]
}

export default getConfigs()

/**
 * Return a list of @tko/* modules.
 */
function getTkoModules () {
  return fs.readdirSync(path.resolve(path.join(getMonorepoRoot(), 'packages')))
    .map(filename => `@tko/${filename}`)
}

/**
 * Create the various configurations for compiling.
 *
 * Note that transpilation includes `import ... 'tko.X'` from `packages/tko.X/dist`,
 * whereas the .es6 versions include from `src/index.js`.  As a result, for example,
 * we re-test from the .es6 version since it'll include code changes from src/,
 * whereas the transpiled .js version imports will be stale (until the packages are
 * recompiled).  This is widely regarded as a nuisance.
 */
function createRollupConfig ({ minify, transpile } = {}) {
  const packageName = getPackageName()
  let filename = path.join(getPackageRoot(), 'dist', packageName)

  const plugins = [...UNIVERSAL_PLUGINS]
  
  plugins.push(typescript({
    ...TYPESCRIPT_CONFIG,
    tsconfigOverride: {
      target: transpile ? 'ES5' : 'ES2017'
    }
  }))

  if (!transpile) {
    // Must come before node resolve.
    plugins.unshift(replacerPlugin)
    filename += '.es6'
  }

  if (minify) {
    plugins.push(babelMinify({ comments: false }))
    filename += '.min'
  }

  filename += '.js'

  return {
    plugins,
    input: path.join(getPackageRoot(), `src/index.${getIndexExtension()}`),
    external: IS_BROWSER_BUNDLE ? undefined : TKO_MODULES,
    output: {
      file: filename,
      format: IS_BROWSER_BUNDLE ? 'umd' : 'es',
      name: IS_BROWSER_BUNDLE ? 'ko' : packageName,
      sourcemap: true
    }
  }
}
