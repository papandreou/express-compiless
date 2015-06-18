/*global describe, it, __dirname*/
var express = require('express'),
    Path = require('path'),
    unexpected = require('unexpected'),
    compiless = require('../lib/compiless');

describe('compiless', function () {
    var root = Path.resolve(__dirname, 'root'),
        expect = unexpected.clone()
            .installPlugin(require('unexpected-fs'))
            .installPlugin(require('unexpected-express'))
            .addAssertion('to yield response', function (expect, subject, value) {
                var root = '/data';
                var app = express()
                    .use(compiless({root: root}))
                    .use('/hello', function (req, res, next) {
                        res.setHeader('Content-Type', 'text/plain');
                        res.setHeader('ETag', 'W/"fake-etag"');
                        res.status(200);
                        res.write('world');
                        res.end();
                    })
                    .use(express['static'](root));
                return expect(app, 'to yield exchange', {
                    request: subject,
                    response: value
                });
            })
            .addAssertion('original to yield response', function (expect, subject, value) {
                return expect(
                    express()
                        .use(compiless({root: root}))
                        .use('/hello', function (req, res, next) {
                            res.setHeader('Content-Type', 'text/plain');
                            res.setHeader('ETag', 'W/"fake-etag"');
                            res.status(200);
                            res.write('world');
                            res.end();
                        })
                        .use(express['static'](root)),
                    'to yield exchange', {
                        request: subject,
                        response: value
                    }
                );
            });

    it('should not mess with request for non-less file', function () {
        return expect('GET /something.txt', 'with fs mocked out', {
            '/data': {
                'something.txt': 'foo\n'
            }
        }, 'to yield response', {
            headers: {
                'Content-Type': 'text/plain; charset=UTF-8',
                'ETag': expect.it('not to match', /-compiless/),
                'Content-Length': '4'
            },
            body: 'foo\n'
        });
    });

    it('should not mess with request for non-less related route', function () {
        return expect('GET /hello', 'to yield response', {
            headers: {
                'Content-Type': 'text/plain',
                'ETag': expect.it('not to match', /-compiless/)
            },
            body: 'world'
        });
    });

    it('should respond with an ETag header and support conditional GET', function () {
        var mockFs = {
            '/data': {
                'simple.less': {
                    _isFile: true,
                    ctime: new Date(2),
                    mtime: new Date(2),
                    content: '#foo { #bar { color: blue; } }'
                }
            }
        };
        return expect('GET /simple.less', 'with fs mocked out', mockFs, 'to yield response', {
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
            }, 'with fs mocked out', mockFs, 'to yield response', {
                statusCode: 304,
                headers: {
                    ETag: etag
                }
            });
        });
    });

    it('should compile less file with @import to css with .compilessinclude rules first', function () {
        var mockFs = {
            '/data': {
                'imports': {
                    'a.less': [
                        'body {',
                        '    width: 100%;',
                        '}',
                        ''
                    ].join('\n')
                },
                'stylesheet.less': [
                    '@import "imports/a.less";',
                    '',
                    '#foo {',
                    '     #bar {',
                    '          color: red;',
                    '     }',
                    '}',
                    '',
                    '// Single-line comment',
                    '',
                    '/* multi-line',
                    '   comment',
                    '*/',
                    ''
                ].join('\n')
            }
        };
        return expect('GET /stylesheet.less', 'with fs mocked out', mockFs, 'to yield response', {
            headers: {
                'Content-Type': 'text/css; charset=utf-8'
            },
            body: '.compilessinclude {background-image: url(imports/a.less); display: none;}\nbody {\n  width: 100%;\n}\n#foo #bar {\n  color: red;\n}\n/* multi-line\n   comment\n*/\n'
        });
    });

    it('should render less file that has a syntax error with the error message as the first thing in the output, wrapped in a body:before rule', function () {
        return expect('GET /syntaxerror.less', 'original to yield response', {
            statusCode: 200,
            headers: {
                'Content-Type': 'text/css; charset=utf-8'
            },
            body: /Error compiling \/syntaxerror.less:.*(?:missing closing `\}`|Unrecognised input\. Possibly missing something) at line 8/
        });
    });

    it('should render less file that has an @import error with the error message as the first thing in the output, wrapped in a body:before rule', function () {
        return expect('GET /importerror.less', 'original to yield response', {
            statusCode: 200,
            headers: {
                'Content-Type': 'text/css; charset=utf-8'
            },
            body: /body:before \{.*Error.*\/importerror\.less.*notfound\.less/
        });
    });

    it('should render less file that has an @import that points at a file with a syntax error', function () {
        return expect('GET /importedsyntaxerror.less', 'original to yield response', {
            statusCode: 200,
            headers: {
                'Content-Type': 'text/css; charset=utf-8'
            },
            body: /Error compiling.*importedsyntaxerror.less:.*(missing closing `\}`|Unrecognised input. Possibly missing something) at line 8/
        });
    });

    it('should render less file that has an second level @import error with the error message as the first thing in the output, wrapped in a body:before rule', function () {
        return expect('GET /secondlevelimporterror.less', 'original to yield response', {
            statusCode: 200,
            headers: {
                'Content-Type': 'text/css; charset=utf-8'
            },
            body: /body:before \{.*Error compiling \/secondlevelimporterror\.less/
        });
    });

    it('should rewrite urls correctly', function () {
        return expect('GET /importLessWithRelativeImageReferenceInDifferentDir.less', 'original to yield response', {
            statusCode: 200,
            headers: {
                'Content-Type': 'text/css; charset=utf-8'
            },
            body: /url\(imports\/images\/foo.png\)/
        });
    });

    it('should deliver a response even though the less file has @imports and references an undefined variable', function () {
        return expect('GET /undefinedVariable.less', 'original to yield response', {
            statusCode: 200,
            headers: {
                'Content-Type': 'text/css; charset=utf-8'
            },
            body: /Error compiling.*variable.*undefined/
        });
    });
});
