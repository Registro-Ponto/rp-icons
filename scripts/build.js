const fs = require('fs').promises
const camelcase = require('camelcase')
const { promisify } = require('util')
const rimraf = promisify(require('rimraf'))
const svgr = require('@svgr/core').default
const babel = require('@babel/core')
const { dirname } = require('path')
const { deprecated } = require('./deprecated')

async function svgToReactComponent(svg, componentName, format, isDeprecated) {
  let component = await svgr(svg, { ref: true, titleProp: true }, { componentName })
  let { code } = await babel.transformAsync(component, {
    plugins: [[require('@babel/plugin-transform-react-jsx'), { useBuiltIns: true }]],
  })

  // Add a deprecation warning to the component
  if (isDeprecated) {
    /** @type {string[]} */
    let lines = code.split('\n')
    lines.splice(1, 0, `/** @deprecated */`)
    code = lines.join('\n')
  }

  code = code.replace('React.forwardRef(', '/*#__PURE__*/ React.forwardRef(')

  if (format === 'esm') {
    return code
  }

  return code
    .replace('import * as React from "react"', 'const React = require("react")')
    .replace('export default', 'module.exports =')
}

async function getSvgs(folderName) {
  let files = await fs.readdir(`./optimized/${folderName}`)
  return Promise.all(
    files.map(async (file) => ({
      svg: await fs.readFile(`./optimized/${folderName}/${file}`, 'utf8'),
      componentName: `${camelcase(file.replace(/\.svg$/, ''), {
        pascalCase: true,
      })}`,
      isDeprecated: deprecated.includes(file),
    }))
  )
}

function exportAll(icons, format, includeExtension = true) {
  return icons
    .map(({ componentName }) => {
      let extension = includeExtension ? '.js' : ''
      if (format === 'esm') {
        return `export { default as ${componentName} } from './${componentName}${extension}'`
      }
      return `module.exports.${componentName} = require("./${componentName}${extension}")`
    })
    .join('\n')
}

async function ensureWrite(file, text) {
  await fs.mkdir(dirname(file), { recursive: true })
  await fs.writeFile(file, text, 'utf8')
}

async function ensureWriteJson(file, json) {
  await ensureWrite(file, JSON.stringify(json, null, 2) + '\n')
}

/**
 *
 * @param {("icons"|"illustrations")} packageName
 * @param {("esm"|"cjs")} format
 */
async function buildIcons(packageName, format) {
  let outDir = `./rp-${packageName}/${packageName}`
  if (format === 'esm') {
    outDir += '/esm'
  }

  let svgs = await getSvgs(packageName)

  await Promise.all(
    svgs.flatMap(async ({ componentName, svg, isDeprecated }) => {
      let content = await svgToReactComponent(svg, componentName, format, isDeprecated)

      /** @type {string[]} */
      let types = []

      types.push(`import * as React from 'react';`)
      if (isDeprecated) {
        types.push(`/** @deprecated */`)
      }
      types.push(
        `declare const ${componentName}: React.ForwardRefExoticComponent<React.PropsWithoutRef<React.SVGProps<SVGSVGElement>> & { title?: string, titleId?: string } & React.RefAttributes<SVGSVGElement>>;`
      )
      types.push(`export default ${componentName};`)

      return [
        ensureWrite(`${outDir}/${componentName}.js`, content),
        ...(types ? [ensureWrite(`${outDir}/${componentName}.d.ts`, types.join('\n') + '\n')] : []),
      ]
    })
  )

  await ensureWrite(`${outDir}/index.js`, exportAll(svgs, format))

  await ensureWrite(`${outDir}/index.d.ts`, exportAll(svgs, 'esm', false))
}

/**
 * @param {("icons"|"illustrations")} packageName
 */
async function main(packageName) {
  const cjsPackageJson = { module: './esm/index.js', sideEffects: false }
  const esmPackageJson = { type: 'module', sideEffects: false }

  console.log(`Construindo pacote ${packageName}...`)

  await Promise.all([rimraf(`./rp-${packageName}/${packageName}/*`)])

  await Promise.all([
    buildIcons(packageName, 'cjs'),
    buildIcons(packageName, 'esm'),
    ensureWriteJson(`./rp-${packageName}/${packageName}/esm/package.json`, esmPackageJson),
    ensureWriteJson(`./rp-${packageName}/${packageName}/package.json`, cjsPackageJson),
  ])

  return console.log(`Construção do pacote ${packageName} finalizada.`)
}

/**
 * @type {("icons"|"illustrations")}
 */
const packageName = process.argv.slice(2)[0]

if (!packageName) {
  throw new Error('Por favor informe o pacote a ser construído: ("icons" || "illustrations")')
} else if (packageName !== 'icons' && packageName !== 'illustrations') {
  throw new Error('O argumento após o comando build deve ser "icons" ou "illustrations"')
}

main(packageName)
