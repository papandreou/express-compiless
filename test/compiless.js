/*global describe, it, __dirname*/
var express = require('express'),
    Path = require('path'),
    unexpected = require('unexpected'),
    compiless = require('../lib/compiless');

describe('compiless', function () {
    var root = Path.resolve(__dirname, 'root'),
        expect = unexpected.clone()
            .installPlugin(require('unexpected-express'))
            .addAssertion('to yield response', function (expect, subject, value) {
                return expect(
                    express()
                        .use(compiless({root: root}))
                        .use('/hello', function (req, res, next) {
                            res.send({foo: 123});
                        })
                        .use(express['static'](root)),
                    'to yield exchange', {
                        request: subject,
                        response: value
                    }
                );
            });

    it('should not mess with request for non-less file', function () {
        return expect('GET /something.txt', 'to yield response', {
            headers: {
                'Content-Type': 'text/plain; charset=UTF-8'
            },
            body: 'foo\n'
        });
    });

    it('should not mess with request for non-less related route', function () {
        return expect('GET /hello', 'to yield response', { body: { foo: 123 } });
    });

    it('should respond with an ETag header and support conditional GET', function () {
        return expect('GET /simple.less', 'to yield response', {
            statusCode: 200,
            headers: {
                'Content-Type': 'text/css; charset=utf-8',
                ETag: /^W\/".*-compiless"$/
            },
            body: '#foo #bar {\n  color: blue;\n}\n'
        }).then(function (context) {
            var etag = context.httpResponse.headers.get('ETag');
            return expect({
                url: 'GET /simple.less',
                headers: {
                    'If-None-Match': etag
                }
            }, 'to yield response', {
                statusCode: 304,
                headers: {
                    ETag: etag
                }
            });
        });
    });

    it('should compile less file with @import to css with .compilessinclude rules first', function () {
        return expect('GET /stylesheet.less', 'to yield response', {
            headers: {
                'Content-Type': 'text/css; charset=utf-8'
            },
            body: '.compilessinclude {background-image: url(imports/a.less); display: none;}\nbody {\n  width: 100%;\n}\n#foo #bar {\n  color: red;\n}\n/* multi-line\n   comment\n*/\n'
        });
    });

    it('should render less file that has a syntax error with the error message as the first thing in the output, wrapped in a body:before rule', function () {
        return expect('GET /syntaxerror.less', 'to yield response', {
            statusCode: 200,
            headers: {
                'Content-Type': 'text/css; charset=utf-8'
            },
            body: /body:before {.*Error compiling \/syntaxerror.less:.*Unrecognised input\. Possibly missing something at line 8/
        });
    });

    it('should render less file that has an @import error with the error message as the first thing in the output, wrapped in a body:before rule', function () {
        return expect('GET /importerror.less', 'to yield response', {
            statusCode: 200,
            headers: {
                'Content-Type': 'text/css; charset=utf-8'
            },
            body: /body:before \{.*Error.*\/importerror\.less.*notfound\.less/
        });
    });

    it('should render less file that has an @import that points at a file with a syntax error', function () {
        return expect('GET /importedsyntaxerror.less', 'to yield response', {
            statusCode: 200,
            headers: {
                'Content-Type': 'text/css; charset=utf-8'
            },
            body: /Error compiling.*importedsyntaxerror.less:.*Unrecognised input. Possibly missing something at line 8/
        });
    });

    it('should render less file that has an second level @import error with the error message as the first thing in the output, wrapped in a body:before rule', function () {
        return expect('GET /secondlevelimporterror.less', 'to yield response', {
            statusCode: 200,
            headers: {
                'Content-Type': 'text/css; charset=utf-8'
            },
            body: /body:before \{.*Error.*\/secondlevelimporterror\.less.*notfound\.less/
        });
    });

    it('should rewrite urls correctly', function () {
        return expect('GET /importLessWithRelativeImageReferenceInDifferentDir.less', 'to yield response', {
            statusCode: 200,
            headers: {
                'Content-Type': 'text/css; charset=utf-8'
            },
            body: /url\(imports\/images\/foo.png\)/
        });
    });

    it('should deliver a response even though the less file has @imports and references an undefined variable', function () {
        return expect('GET /undefinedVariable.less', 'to yield response', {
            statusCode: 200,
            headers: {
                'Content-Type': 'text/css; charset=utf-8'
            },
            body: /Error compiling.*variable.*undefined/
        });
    });
});
