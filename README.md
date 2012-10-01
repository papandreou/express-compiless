express-compiless
=================

Middleware that compiles less to css on-the-fly. Intended to be used
in a development setting with the `connect.static` middleware, but
should work with any middleware further down the stack, as long as a
`text/less` response is served. Or if the `Content-Type` of the
response is `application/octet-stream` and the request url ends in
`.less`.

Installation
------------

Make sure you have node.js and npm installed, then run:

    npm install express-compiless

Example usage
-------------

```javascript
var express = require('express'),
    compiless = require('express-compiless'),
    root = '/path/to/my/static/files';

express.createServer()
    .use(compiless({root: root}))
    .use(express.static(root))
    .listen(1337, done);
```

License
-------

3-clause BSD license -- see the `LICENSE` file for details.
