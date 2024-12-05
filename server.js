const fs = require('fs')
const fsp = require('fs').promises
const path = require('path')
const { mkdirp } = require('mkdirp')
const { exec } = require('child_process')
const split = require('split')
const browserify = require('browserify')
const watchify = require('watchify')
const envify = require('@browserify/envify/custom')
const chokidar = require('chokidar')
const { DateTime } = require('luxon')
const less = require('less')
const http = require('http')
const https = require('https')
const ws = require('ws')

function setup(jsin, others) {
  const b = browserify({ entries: [jsin], cache: {}, packageCache: {} })
  b.plugin(watchify, { poll: 250 })
  const fn = envify(process.env)
  b.transform(fn)
  const ch = chokidar.watch(others, {})
  return [b, ch]
}

async function deleteFileType(dir, ext) {
  const entries = await fsp.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await deleteFileType(fullPath, ext)
    } else if (entry.isFile() && path.extname(entry.name) === ext) {
      await fsp.unlink(fullPath)
    }
  }
}

function onJsChange(bundle, jsout, wssPush) {
  let error = false
  const output = fs.createWriteStream(jsout)
  return new Promise((res, rej) => {
    output.once('close', () => {
      if (error) { return res() }
      const time = DateTime.now().toFormat('HH:mm:ss')
      console.log(`${time} wrote ${jsout}`)
      wssPush(true)
      res()
    })
    bundle.bundle().once('error', (err) => {
      error = true
      console.error(err)
      output.end()
    }).pipe(output)
  })
}

function onLessCssChange(input, outdir, wssPush) {
  let cssout = input.replace('.less', '.css')
  cssout = `${outdir}/${cssout}`
  let opts = { encoding: 'utf8' }
  const style = fs.readFileSync(input, opts)
  opts = { filename: input }
  return less.render(style, opts).then((bundle) => {
    fs.writeFileSync(cssout, bundle.css) 
    const time = DateTime.now().toFormat('HH:mm:ss')
    console.log(`${time} wrote ${cssout}`)
    wssPush(false, true)
  }).catch(console.error)
}

function onAssetChange(input, output, wssPush, startup) {
  return new Promise((res, rej) => {
    fs.createReadStream(input)
      .pipe(fs.createWriteStream(output))
      .once('close', () => {
        if (startup) { return res() }
        const time = DateTime.now().toFormat('HH:mm:ss')
        console.log(`${time} wrote ${output}`)
        const js = output.endsWith('.js') || output.endsWith('.html')
        const css = output.endsWith('.css')
        wssPush(js, css)
        res()
      })
  })
}

function runCmd(cmd, wssPush) {
  if (!cmd) { return Promise.resolve() }
  console.log(`${cmd} ...`)
  return new Promise((res, rej) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.error(`${cmd} ... error ${stderr}`)
      } else {
        console.log(`${cmd} ... ok`)
      }
      wssPush(true)
      res()
    })
  })
}

module.exports = async function server(argv) {
  const inputs = argv._
  const jsin = inputs[0]
  const jsout = argv.o
  const rel = argv.rel
  const lessin = argv.less
  const cmd = argv.c

  let port = argv.p
  if (!port) { port = 8080 }

  if (inputs.length <= 0) {
    throw new Error('require at least one input file')
  } else if (typeof jsin !== 'string' || !jsin.endsWith('.js')) {
    throw new Error('first input file must be js main')
  } else if (typeof jsout !== 'string' || jsout.indexOf('/') < 0 || !jsout.endsWith('.js')) {
    throw new Error('require -o dir/bundle.js')
  }

  let outdir = jsout.split('/')
  outdir = outdir.slice(0, outdir.length - 1).join('/')
  outdir = rel ? rel : outdir
  await mkdirp(outdir)

  let base = outdir
  if (rel) {
    base = base.split('/')
    base = base.slice(0, base.length - 1).join('/')
  }

  if (typeof argv.http === 'string') { argv.http = [argv.http] }
  if (typeof argv.https === 'string') { argv.https = [argv.https] }
  argv.http = argv.http ? argv.http : []
  argv.https = argv.https ? argv.https : []

  const map = (https=0) => (rule) => {
    let host = rule.split('/')[0]
    const port = host.split(':')[1]
    host = host.split(':')[0]
    const path = '/' + rule.split('/').slice(1).join('/')
    return { host, port, path, https }
  }

  argv.http = argv.http.map(map())
  argv.https = argv.https.map(map(1))
  const fwdHosts = [...argv.http, ...argv.https]

  const [bundle, watcher] = setup(jsin, inputs.slice(1))
  const wss = new ws.WebSocketServer({ noServer: true, clientTracking: true })

  const wssPush = (js=false, css=false) => {
    wss.clients.forEach((client) => {
      if (client.readyState !== ws.WebSocket.OPEN) { return }
      client.send(JSON.stringify({ js, css }))
    })
  }

  const onJsChangee = async () => {
    await onJsChange(bundle, jsout, wssPush)
    return runCmd(cmd, wssPush)
  }

  let startup = true
  setTimeout(() => startup = false, 5_000)

  const onAssetChangee = (path) => {
    let todo = null
    if (!startup && path.endsWith('.less')) {
      todo = onLessCssChange(lessin, outdir, wssPush)
    } else if (path.endsWith('.swp') || path.endsWith('.less')) {
      // todo: use .gitignore
      todo = null
    } else if (path.endsWith('index.html')) {
      todo = onAssetChange(path, `${base}/${path}`, wssPush, startup)
    } else {
      todo = onAssetChange(path, `${outdir}/${path}`, wssPush, startup)
    }
    if (!todo || startup) { return }
    return todo.then(() => runCmd(cmd, wssPush))
  }

  const forceChange = async () => {
    for (let input of inputs.slice(1)) {
      const outdirr = input.endsWith('.html') ? base : outdir
      const output = `${outdirr}/${input}`
      fs.cpSync(input, output, { recursive: true })
      const time = DateTime.now().toFormat('HH:mm:ss')
      console.log(`${time} wrote ${output}`)
    }
    await deleteFileType(base, '.less')
    await onJsChangee()
    if (!lessin) { return }
    await onLessCssChange(lessin, outdir, wssPush)
    await runCmd(cmd, wssPush)
  }

  return new Promise((res, rej) => {
    console.log('hit ENTER to force reload')
    watcher.on('add', onAssetChangee)
    watcher.on('change', onAssetChangee)
    bundle.on('update', onJsChangee)

    forceChange().catch(rej)
    process.stdin.pipe(split()).on('data', () => forceChange().catch(rej))

    const wssKeepAlive = () => {
      wss.clients.forEach((client) => {
        if (client.readyState !== ws.WebSocket.OPEN) { return }
        client.send(JSON.stringify({ keepalive: true }))
      })
    }

    wss.on('error', rej)
    wss.on('connection', (client) => client.on('error', rej))
    setInterval(wssKeepAlive, 10 * 1000)

    let clientjs = path.resolve(__dirname, 'client.js')
    clientjs = fs.readFileSync(clientjs, 'utf8')
    clientjs = `<script>\n${clientjs}\n</script>`

    const exists = (path) => fs.existsSync(path)

    const fwdHost = (path) => fwdHosts.find((host) => path.startsWith(host.path))

    const fixCookies = (headers, cookieDomain) => {
      let cookies = headers.getSetCookie()
      if (!cookies) { return headers }
      if (!Array.isArray(cookies)) { cookies = [cookies] }
      cookies = cookies.map((sc) => {
        sc = sc.split(';')
        sc = sc.filter((s) => s.trim().toLowerCase() !== 'secure')
        sc = sc.filter((s) => s.trim().toLowerCase().indexOf('secure=') !== 0).map((s) => {
          if (s.trim().toLowerCase().startsWith('domain=')) { return `domain=${cookieDomain}` }
          return s
        })
        return sc.join('; ')
      })
      headers['set-cookie'] = cookies
      return headers
    }

    const fwdRequest = (fwd, request, response) => {
      let url = `${fwd.host}:${fwd.port}${request.url}`
      url = fwd.https ? `https://${url}` : `http://${url}`
      const opts = { method: request.method, headers: request.headers }

      const ogHost = opts.headers['x-original-host']
      const cookieDomain = ogHost ? ogHost : 'localhost'

      fetch(url, opts).then((res) => {
        let { status, headers } = res
        headers = fixCookies(headers, cookieDomain)
        if (!res.ok) {
          response.writeHead(status, headers)
          res.text()
            .then((str) => response.end(str))
            .catch((err) => response.end(`${status}`))
          return
        }
        return res.text().then((str) => {
          response.writeHead(status, headers)
          response.end(str)
        })
      }).catch((err) => {
        response.writeHead(500)
        response.end(err.message)
      })
    }

    const httpServer = http.createServer((request, response) => {
      const path = request.url
      const fwd = fwdHost(path)
      if (fwd) { return fwdRequest(fwd, request, response) }

      // serve exact
      let file = `${base}${path}`
      if (!file.endsWith('/') && exists(file)) {
        response.writeHead(200)
        fs.createReadStream(file).pipe(response)
        return
      }

      // serve approx or index
      file = `${base}${path}.html`
      file = exists(file) ? file : `${base}/index.html`
      file = fs.readFileSync(file, 'utf8')

      // add client.js
      file = file.replace('</body>', `${clientjs}\n</body>`)
      response.writeHead(200)
      response.end(file)
    })

    httpServer.on('upgrade', (request, socket, head) => {
      wss.handleUpgrade(request, socket, head, (client) => {
        wss.emit('connection', client, request)
      })
    })

    httpServer.listen(port)
  })
}
