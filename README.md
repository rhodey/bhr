# bhr
Browserify hot reload server for single page applications. [Chokidar](https://www.npmjs.com/package/chokidar) watches for filesystem changes but you can hit ENTER to force reload. Sometimes webpack, etc is overkill.

## Usage
The third and fourth examples show how to forward certain paths to api servers
```
npm install -g browserify-hot-reload
bhr main.js index.html assets/ -o dist/bundle.js
bhr main.js index.html assets/ -o dist/bundle.js -p 8080
bhr main.js index.html assets/ -o dist/bundle.js -p 8080 --http localhost:8081/api/a --http localhost:8082/api/b
bhr main.js index.html assets/ -o dist/bundle.js -p 8080 --https your.prod.server:443/api
```

You can also specify a command to run when any of the watched paths change
```
bhr main.js index.html assets/ -o dist/bundle.js -c "npm run something"
```

## Envify
[Envify](https://www.npmjs.com/package/@browserify/envify) is enabled so you can use `process.env.VAR_NAME` in source

## License
Copyright 2025 - mike@rhodey.org

MIT
