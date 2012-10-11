var express = require('express'),
    Path = require('path'),
    request = require('request'),
    passError = require('passerror'),
    expect = require('expect.js'),
    compiless = require('../lib/');

describe('test server', function () {
    var root = Path.resolve(__dirname, 'root'),
        // Pick a random TCP port above 10000 (.listen(0) doesn't work anymore?)
        portNumber = 10000 + Math.floor(55536 * Math.random()),
        baseUrl = 'http://127.0.0.1:' + portNumber,
        server;

    before(function (done) {
        server = express.createServer()
            .use(compiless({root: root}))
            .use(express.static(root))
            .listen(portNumber, done);
    });

    after(function () {
        server.close();
    });

    it('request for non-less file', function (done) {
        request(baseUrl + '/something.txt', passError(done, function (response, body) {
            expect(body).to.equal("foo\n");
            expect(response.headers['content-type']).to.equal('text/plain; charset=UTF-8');
            done();
        }));
    });

    it('request for less file with @import', function (done) {
        request(baseUrl + '/stylesheet.less', passError(done, function (response, body) {
            expect(body).to.equal('.compilessinclude {background-image: url(imports/a.less); display: none;}\nbody {\n  width: 100%;\n}\n#foo #bar {\n  color: red;\n}\n');
            expect(response.headers['content-type']).to.equal('text/css');
            done();
        }));
    });

    // Unfortunately less.render throws instead of passing the error to our callback.
    // Hopefully the solution for https://github.com/cloudhead/less.js/issues/462 will remedy this.

    /*
    it('request for less file with syntax error', function (done) {
        request(baseUrl + '/syntaxerror.less', passError(done, function (response, body) {
            expect(response.statusCode).to.equal(500);
            done();
        }));
    });

    it('request for less file with @import error', function (done) {
        request(baseUrl + '/importerror.less', passError(done, function (response, body) {
            expect(response.statusCode).to.equal(500);
            done();
        }));
    });
    */
});
