#!/usr/bin/env node

const bhr = require('./')
const minimist = require('minimist')
const argv = minimist(process.argv.slice(2))

bhr(argv).catch((err) => {
  console.error(err)
  process.exit(1)
})
