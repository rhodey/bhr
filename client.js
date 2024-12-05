const proto = document.location.protocol === 'https:' ? 'wss:' : 'ws:'

let host = document.location.host
let port = host.split(':')[1]
port = port ? `:${port}` : ''
host = host.split(':')[0]

const socket = new WebSocket(`${proto}//${host}${port}/ws`)

socket.addEventListener('message', (event) => {
  const data = JSON.parse(event.data)
  if (data.keepalive) { return }
  if (data.js) { return document.location.reload() }
  let prev = Array.from(document.head.children)
  prev = prev.filter((elem) => elem.rel === 'stylesheet')
  prev = prev.find((elem) => elem.attributes?.href && elem.attributes.href.value.startsWith('/'))
  if (!prev) { return console.error('cannot find stylesheet in head') }
  const next = document.createElement('link')
  next.setAttribute('rel', 'stylesheet')
  next.setAttribute('href', prev.attributes.href.value)
  prev.parentNode.replaceChild(next, prev)
})
