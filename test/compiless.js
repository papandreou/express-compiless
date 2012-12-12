var express = require('express'),
    Path = require('path'),
    request = require('request'),
    passError = require('passerror'),
    expect = require('expect.js'),
    compiless = require('../lib/compiless');

describe('test server with compiless', function () {
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

    it('should not mess with request for non-less file', function (done) {
        request(baseUrl + '/something.txt', passError(done, function (response, body) {
            expect(body).to.equal("foo\n");
            expect(response.headers['content-type']).to.equal('text/plain; charset=UTF-8');
            done();
        }));
    });

    it('should compile less file with @import to css with .compilessinclude rules first', function (done) {
        request(baseUrl + '/stylesheet.less', passError(done, function (response, body) {
            expect(body).to.equal('.compilessinclude {background-image: url(imports/a.less); display: none;}\nbody {\n  width: 100%;\n}\n#foo #bar {\n  color: red;\n}\n');
            expect(response.headers['content-type']).to.equal('text/css');
            done();
        }));
    });

    it('should render less file that has a syntax error with the error message as the first thing in the output, wrapped in a body:before rule', function (done) {
        request(baseUrl + '/syntaxerror.less', passError(done, function (response, body) {
            expect(response.statusCode).to.equal(200);
            expect(response.headers['content-type']).to.equal('text/css');
            expect(body).to.match(/^body:before \{.*Error.*\/syntaxerror\.less.*missing closing `\}`/);
            done();
        }));
    });

    it('should render less file that has an @import error with the error message as the first thing in the output, wrapped in a body:before rule', function (done) {
        request(baseUrl + '/importerror.less', passError(done, function (response, body) {
            expect(response.statusCode).to.equal(200);
            expect(response.headers['content-type']).to.equal('text/css');
            expect(body).to.match(/^body:before \{.*Error.*\/importerror\.less.*ENOENT.*notfound\.less/);
            done();
        }));
    });

    it('should render less file that has an second level @import error with the error message as the first thing in the output, wrapped in a body:before rule', function (done) {
        request(baseUrl + '/secondlevelimporterror.less', passError(done, function (response, body) {
            expect(response.statusCode).to.equal(200);
            expect(response.headers['content-type']).to.equal('text/css');
            expect(body).to.match(/^body:before \{.*Error.*\/secondlevelimporterror\.less.*ENOENT.*notfound\.less/);
            done();
        }));
    });
});
