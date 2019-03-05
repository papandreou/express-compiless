var Path = require('path');
var crypto = require('crypto');
var fs = require('fs');
var async = require('async');
var csserror = require('csserror');
var passError = require('passerror');
var hijackResponse = require('hijackresponse');

module.exports = function compiless(options) {
    if (!options || !options.root) {
        throw new Error('options.root is mandatory');
    }

    var less = options.less || require('less');
    var isOldLessApi = !less.version || less.version[0] < 2;
    var plugins = options.plugins || [];
    if (plugins.length > 0 && isOldLessApi) {
        throw new Error('Less version < 2.0.0 does not support plugins');
    }
    var toCSSOptions = options.toCSSOptions || {};

    function formatError(err) { // err can either be a string or an error object
        if (typeof err === 'string') {
            return err;
        } else {
            // Assume error object
            return err.message + ('line' in err ? ' at line ' + err.line + ('column' in err ? ', column ' + err.column : '') : '') +
                ('extract' in err ? ':\n' + err.extract.join('\n') : '');
        }
    }

    return function (req, res, next) {
        // Prevent If-None-Match revalidation with the downstream middleware with ETags that aren't suffixed with "-compiless":
        var ifNoneMatch = req.headers['if-none-match'];

        // only hijack requests for .less files
        if (/\.less$/.test(req.originalUrl)) {
            if (ifNoneMatch) {
                var validIfNoneMatchTokens = ifNoneMatch.split(" ").filter(function (etag) {
                    return /-compiless\"$/.test(etag);
                });

                if (validIfNoneMatchTokens.length > 0) {
                    req.headers['if-none-match'] = validIfNoneMatchTokens.join(" ");
                } else {
                    delete req.headers['if-none-match'];
                }
            }
            delete req.headers['if-modified-since']; // Prevent false positive conditional GETs after enabling compiless

            hijackResponse(res, function (err, res) {
                if (err) {
                    res.unhijack();
                    return next(err);
                }

                var contentType = res.getHeader('Content-Type');
                    var matchContentType = contentType && contentType.match(/^text\/less(?:;\s*charset=([a-z0-9\-]+))?$/i);

                // The mime module doesn't support less yet, so we fall back:
                if (!(matchContentType || contentType === 'application/octet-stream')) {
                    return res.unhijack();
                }

                var baseDir = Path.resolve(options.root, req.url.replace(/\/[^\/]*(?:\?.*)?$/, '/').substr(1));
                    var filename = Path.resolve(options.root, req.url.substr(1));
                    var lessOptions = {
                        paths: [baseDir],
                        filename: filename,
                        plugins: plugins,
                        relativeUrls: true
                    };

                function sendErrorResponse(err, cssText) {
                    var errorMessage = "express-compiless: Error compiling " + req.originalUrl + ":\n" + formatError(err);
                    res.removeHeader('Content-Length');
                    res.removeHeader('ETag');
                    res.setHeader('Content-Type', 'text/css; charset=utf-8');
                    res.end(csserror(errorMessage) + '\n' + (cssText || ''));
                }

                function respondWithCss(css, importedFileNames) {
                    importedFileNames = importedFileNames || [];
                    var statsByFileName = {};
                    async.eachLimit(importedFileNames, 10, function (importedFileName, cb) {
                        fs.stat(importedFileName, passError(cb, function (stats) {
                            statsByFileName[importedFileName] = stats;
                            cb();
                        }));
                    }, passError(sendErrorResponse, function () {
                        var oldETag = res.getHeader('ETag');

                        if (oldETag) {
                            var oldETagIsWeak = oldETag && /^W\//.test(oldETag);
                                var etagFragments = [oldETag.replace(/^(?:W\/)?"|"$/g, '')];

                            if (importedFileNames.length) {
                                var importedFileStats = [];

                                importedFileNames.sort().forEach(function (importedFileName) {
                                    var stats = statsByFileName[importedFileName];
                                    importedFileStats.push(importedFileName, String(stats.mtime.getTime()), String(stats.size));
                                }, this);

                                etagFragments.push(crypto.createHash('md5').update(importedFileStats.join('-')).digest('hex').substr(0, 16));
                            }

                            var newETag = (oldETagIsWeak ? 'W/' : '') + '"' + etagFragments.join('-') + '-compiless"';
                            res.setHeader('ETag', newETag);

                            if (ifNoneMatch && ifNoneMatch.indexOf(newETag) !== -1) {
                                return res.status(304).send();
                            }
                        }

                        var cssText = importedFileNames.map(function (importedFileName) {
                            return ".compilessinclude {background-image: url(" + Path.relative(baseDir, importedFileName) + "); display: none;}\n";
                        }).join("") + css;

                        res.setHeader('Content-Type', 'text/css; charset=utf-8');
                        res.setHeader('Content-Length', Buffer.byteLength(cssText));
                        res.end(cssText);
                    }));
                }

                var chunks = [];
                res.on('data', function (chunk) {
                    chunks.push(chunk);
                }).on('end', function () {
                    var lessText = Buffer.concat(chunks).toString();

                    if (isOldLessApi) {
                        var parser = new less.Parser(lessOptions);
                        parser.parse(lessText, passError(sendErrorResponse, function (root) {
                            var css;
                            try {
                                css = root.toCSS(toCSSOptions);
                            } catch (e) {
                                return sendErrorResponse(e);
                            }
                            respondWithCss(css, parser.imports && parser.imports.files && Object.keys(parser.imports.files));
                        }));
                    } else {
                        less.render(lessText, lessOptions, passError(sendErrorResponse, function (output) {
                            respondWithCss(output.css, output.imports);
                        }));
                    }
                });
            }, {disableBackpressure: true});
        }
        next();
    };
};
