var express = require('express'),
    Path = require('path'),
    request = require('request'),
    passError = require('passerror'),
    unexpected = require('unexpected'),
    compiless = require('../lib/compiless');

describe('compiless', function () {
    var root = Path.resolve(__dirname, 'root'),
        expect = unexpected.clone()
            .installPlugin(require('unexpected-messy'))
            .installPlugin(require('unexpected-express'))
            .addAssertion('to yield response', function (expect, subject, value, done) {
                expect(express().use(compiless({root: root})).use(express.static(root)), 'to yield exchange', {
                    request: subject,
                    response: value
                }, done);
            });

    it('should not mess with request for non-less file', function (done) {
        expect('GET /something.txt', 'to yield response', {
            headers: {
                'Content-Type': 'text/plain; charset=UTF-8'
            },
            body: 'foo\n'
        }, done);
    });

    it('should compile less file with @import to css with .compilessinclude rules first', function (done) {
        expect('GET /stylesheet.less', 'to yield response', {
            headers: {
                'Content-Type': 'text/css; charset=utf-8'
            },
            body: '.compilessinclude {background-image: url(imports/a.less); display: none;}\nbody {\n  width: 100%;\n}\n#foo #bar {\n  color: red;\n}\n/* multi-line\n   comment\n*/\n'
        }, done);
    });

    it('should render less file that has a syntax error with the error message as the first thing in the output, wrapped in a body:before rule', function (done) {
        expect('GET /syntaxerror.less', 'to yield response', {
            statusCode: 200,
            headers: {
                'Content-Type': 'text/css; charset=utf-8'
            },
            body: /body:before \{.*Error.*\/syntaxerror\.less.*missing closing `\}` at line 8/
        }, done);
    });

    it('should render less file that has an @import error with the error message as the first thing in the output, wrapped in a body:before rule', function (done) {
        expect('GET /importerror.less', 'to yield response', {
            statusCode: 200,
            headers: {
                'Content-Type': 'text/css; charset=utf-8'
            },
            body: /body:before \{.*Error.*\/importerror\.less.*notfound\.less/
        }, done);
    });

    it('should render less file that has an second level @import error with the error message as the first thing in the output, wrapped in a body:before rule', function (done) {
        expect('GET /secondlevelimporterror.less', 'to yield response', {
            statusCode: 200,
            headers: {
                'Content-Type': 'text/css; charset=utf-8'
            },
            body: /body:before \{.*Error.*\/secondlevelimporterror\.less.*notfound\.less/
        }, done);
    });

    it('should rewrite urls correctly', function (done) {
        expect('GET /importLessWithRelativeImageReferenceInDifferentDir.less', 'to yield response', {
            statusCode: 200,
            headers: {
                'Content-Type': 'text/css; charset=utf-8'
            },
            body: /url\(imports\/images\/foo.png\)/
        }, done);
    });

    it('should deliver a response even though the less file has @imports and references an undefined variable', function (done) {
        expect('GET /undefinedVariable.less', 'to yield response', {
            statusCode: 200,
            headers: {
                'Content-Type': 'text/css; charset=utf-8'
            },
            body: /Error compiling.*variable.*undefined/
        }, done);
    });
});
