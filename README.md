express-compiless
=================

Middleware that compiles less to css on-the-fly. Intended to be used
in a development setting with the `connect.static` middleware, but
should work with any middleware further down the stack, even an http
proxy.

The response will be rewritten under these circumstances:

* If the response is served with a `Content-Type` of `text/less`.
* If the request url ends in `.less` (excluding GET parameters) and
  the `Content-Type` is `application/octet-stream` (this is what
  <a href="https://senchalabs/connect/">Connect</a>'s `static`
  middleware does.

Compiless plays nice with conditional GET. If the original response
has an ETag, compiless will add to it so the ETag of the compiled
response never clashes with the original ETag. That prevents the
middleware issuing the original response from being confused into
sending a false positive `304 Not Modified` if compiless is turned
off or removed from the stack later.


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
    .listen(1337);
```

License
-------

3-clause BSD license -- see the `LICENSE` file for details.
